/**
 * Tests for SpecSiteBuilder — the "armed" agent that spends real money every
 * run: an Anthropic content call, up to 5 Imagen calls (hero/about/og/trust
 * strip B/C), a Klaviyo list-create, and a Sanity write transaction. Every
 * external integration is mocked here (Anthropic, Imagen, Sanity, Klaviyo,
 * favicon, DB) — this suite must NEVER touch a real API or DB.
 *
 * Covered:
 *  - dedupeKeyFn: `bs:<buildsell_site_id>:<build_epoch>`
 *  - guards: site not found throws with zero external calls; rebuild of a
 *    paid/live site without force_rebuild throws RebuildProtectedError with
 *    ZERO db writes and zero paid calls; force_rebuild bypasses the guard
 *  - REAL BUG (documented, not fixed): force_rebuild:true on a 'live' site
 *    bypasses index.ts's own guard but still burns Anthropic + Imagen spend
 *    before persist-sanity's independent siteStatus==='live' defense-in-depth
 *    check throws RebuildProtectedError — money is spent on a run that can
 *    never succeed
 *  - existing-Sanity-doc read: non-fatal fetch failure; themeLocked:true
 *    forces preserve_theme even when the input payload didn't set it;
 *    migrated overlay skips hero/about image generation AND favicon
 *    generation (money guard)
 *  - content generation: model/tool/prompt wiring (rotation directives,
 *    clarifying_prompt inclusion), "no tool_use in response" throw, lint
 *    violation → single conditional retry (improves / doesn't improve /
 *    retry itself throws) — each without ever throwing out of execute()
 *  - per-run cost cap: assertUnderCap() throws BudgetExceededError right
 *    after the first content generation when over cap — image gen, favicon,
 *    Klaviyo, and the Sanity write are ALL skipped (money guard); a cap
 *    blown only during the lint-retry pass is NOT caught by assertUnderCap
 *    (only checked once) but still gates out later image spend via the
 *    per-step underCap() checks — documented as a real gap, not fixed
 *  - hero/about/og image gating: migrated-asset skip, cap-gated skip,
 *    non-fatal throw, null-return (imagen no-op) all leave the pipeline
 *    completing successfully
 *  - trust-layout hero strip: only fires for layoutVariant==='trust' AND a
 *    successful hero image; stops mid-loop when the cap is exhausted
 *  - favicon: color derivation from the resolved theme preset; non-fatal
 *    throw
 *  - Klaviyo: env-gated skip, idempotent existing-list skip, create-on-miss,
 *    non-fatal create failure
 *  - final DB status: 'invoiced' is preserved across a rebuild; everything
 *    else lands 'draft' (including a force-rebuilt 'paid' site — also
 *    flagged as a real surprise, not fixed)
 *  - output shape matches SpecSiteBuilderOutput
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';
import type { SpecSiteContent as SpecSiteContentType } from './schema';
import type { ExistingDocFields } from './persist-sanity';

const SITE_ID = '55555555-5555-5555-5555-555555555555';

// ── Mutable DB mock state, reset in beforeEach ──────────────────────────────
let mockSiteRow: Record<string, unknown> | null = null;
let mockSameMarketCount = 1; // → rotationSeed(0) → pool index 0 picks
let mockKlaviyoRow: Record<string, unknown> | null = null;
const updateCalls: Array<Record<string, unknown>> = [];

vi.mock('@leadlandlord/db', () => {
  const buildsellSitesTable = {
    __table: 'buildsellSites',
    id: 'id',
    trade: 'trade',
    city: 'city',
    klaviyoListId: 'klaviyoListId',
  };

  let pendingSelectCols: Record<string, unknown> | undefined;

  const db = {
    select: (cols?: Record<string, unknown>) => {
      pendingSelectCols = cols;
      return db;
    },
    from: () => db,
    where: () => {
      const cols = pendingSelectCols;
      let rows: unknown[];
      if (cols && Object.prototype.hasOwnProperty.call(cols, 'value')) {
        rows = [{ value: mockSameMarketCount }];
      } else if (cols && Object.prototype.hasOwnProperty.call(cols, 'klaviyoListId')) {
        rows = mockKlaviyoRow ? [mockKlaviyoRow] : [];
      } else {
        rows = mockSiteRow ? [mockSiteRow] : [];
      }
      return {
        limit: async () => rows,
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(rows).then(resolve, reject),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        updateCalls.push(vals);
        return { where: async () => {} };
      },
    }),
  };

  return { getDb: () => db, buildsellSites: buildsellSitesTable };
});

// ── Anthropic (content generation — real money) ─────────────────────────────
const mockAnthropicCreate = vi.fn();
const mockEstimateCostUsd = vi.fn((_model: string, _usage: unknown) => 0.01);
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: mockAnthropicCreate } }),
  estimateCostUsd: (model: string, usage: unknown) => mockEstimateCostUsd(model, usage),
}));

// ── Imagen (hero/about/og/trust-strip images — real money) ─────────────────
const mockGenerateHeroImageBuffer = vi.fn();
vi.mock('@leadlandlord/integrations/imagen', () => ({
  generateHeroImageBuffer: (...args: unknown[]) => mockGenerateHeroImageBuffer(...args),
}));

// ── Sanity (existing-doc read + hero/about/og upload + persist write) ──────
const mockGetDocument = vi.fn();
const mockTxCreateOrReplace = vi.fn();
const mockTxCommit = vi.fn();
const mockTransaction = vi.fn(() => ({ createOrReplace: mockTxCreateOrReplace, commit: mockTxCommit }));
const mockCreateWriteClient = vi.fn(() => ({ getDocument: mockGetDocument, transaction: mockTransaction }));
const mockUploadHeroImage = vi.fn();
vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: () => mockCreateWriteClient(),
  uploadHeroImage: (...args: unknown[]) => mockUploadHeroImage(...args),
}));

// ── Favicon ──────────────────────────────────────────────────────────────
const mockGenerateAndUploadFavicon = vi.fn();
vi.mock('@leadlandlord/integrations/favicon', () => ({
  generateAndUploadFavicon: (...args: unknown[]) => mockGenerateAndUploadFavicon(...args),
}));

// ── Klaviyo (list creation — real money-ish, monthly billing) ──────────────
const mockKlaviyoCreateList = vi.fn();
vi.mock('@leadlandlord/integrations', () => ({
  klaviyo: { createList: (...args: unknown[]) => mockKlaviyoCreateList(...args) },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const NOOP_LOG = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

function makeCtx(): AgentContext & { log: ReturnType<typeof NOOP_LOG> } {
  return {
    runId: 'test-run',
    log: NOOP_LOG(),
    parentRunId: null,
    recordUsage: vi.fn(),
    progress: vi.fn(),
    emitNextStepEvent: vi.fn(async () => {}),
  } as unknown as AgentContext & { log: ReturnType<typeof NOOP_LOG> };
}

type Exec = (input: unknown, ctx: AgentContext) => Promise<Record<string, unknown>>;

async function getAgent() {
  const { SpecSiteBuilder } = await import('./index');
  const agent = new SpecSiteBuilder();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    businessName: 'Acme Plumbing',
    trade: 'plumbing',
    city: 'Austin',
    state: 'TX',
    status: 'draft',
    ownerEmail: null,
    placeId: 'place-123',
    paymentLink: null,
    metadata: { rating: 4.8, userRatingCount: 120, primaryType: 'plumber' },
    ...overrides,
  };
}

function buildContent(overrides: Record<string, unknown> = {}): SpecSiteContentType {
  const base = {
    seo: {
      metaTitle: 'Acme Plumbing — Plumbing in Austin, TX',
      metaDescription: 'Acme Plumbing provides trusted plumbing services in Austin, TX.',
      ogImagePrompt: 'Plumber at work, clean composition, no text',
    },
    navigation: [
      { label: 'Services', href: '#services' },
      { label: 'About', href: '#about' },
      { label: 'Contact', href: '#contact' },
    ],
    theme: {
      preset: 'Aqua Slate',
      layoutVariant: 'split',
      primary: '#0e7490',
      primaryDark: '#155e75',
      accent: '#f59e0b',
      onPrimary: '#ffffff',
      bg: '#f8fafc',
      surface: '#ffffff',
      text: '#0f172a',
      muted: '#64748b',
      fontHeading: 'Poppins',
      fontBody: 'Inter',
    },
    hero: {
      eyebrow: "Austin's trusted plumbers",
      headline: 'Reliable Plumbing You Can Count On',
      subhead: 'Fast, professional plumbing service in Austin.',
      badges: [
        { icon: 'shield-check', label: 'Licensed & Insured' },
        { icon: 'star', label: 'Highly Rated' },
        { icon: 'clock', label: 'Fast Response' },
      ],
      primaryCta: { label: 'Get a Free Quote', href: '#contact', style: 'primary' },
      secondaryCta: { label: 'Call Us Today', href: 'tel:', style: 'secondary' },
      imagePrompt: 'Plumber replacing a corroded pipe under a kitchen sink, natural light, no text',
    },
    services: {
      heading: 'What We Do',
      cards: Array.from({ length: 4 }, (_, i) => ({
        icon: 'wrench',
        title: `Service ${i + 1}`,
        description: 'Fast, dependable repairs done right.',
      })),
    },
    about: {
      heading: 'Your Local Plumbing Experts',
      body: 'Acme is a locally trusted plumbing provider in Austin, TX.',
      stats: [
        { value: '10+', label: 'Years serving the area' },
        { value: '1,000+', label: 'Jobs completed' },
      ],
      imagePrompt: 'Plumbing team in uniform, friendly smiles, natural light',
    },
    process: {
      heading: 'How It Works',
      steps: [
        { icon: 'phone', title: 'Get in Touch', description: 'Call or fill out the quote form.' },
        { icon: 'calendar', title: 'Schedule', description: 'We find a time that works for you.' },
        { icon: 'check', title: 'Done Right', description: 'Quality work, backed by our guarantee.' },
      ],
    },
    reviews: {
      heading: 'What Our Customers Say',
      items: [
        { author: 'Maria G.', rating: 5, text: 'Showed up on time and did a great job.' },
        { author: 'James T.', rating: 5, text: 'Transparent pricing and great communication.' },
        { author: 'Priya S.', rating: 4, text: 'Professional and friendly.' },
      ],
    },
    contact: {
      heading: 'Get Your Free Quote',
      subhead: "Reach out and we'll respond quickly.",
      hours: 'Mon–Sat 7am–6pm',
      serviceArea: 'Austin and surrounding areas',
    },
    footer: {
      tagline: 'Acme — quality plumbing you can count on.',
      legal: '© 2026 Acme. All rights reserved.',
    },
  };
  return { ...base, ...overrides } as unknown as SpecSiteContentType;
}

function toolUseResponse(input: unknown, usage: Record<string, number> = { input_tokens: 500, output_tokens: 900 }) {
  return { content: [{ type: 'tool_use', name: 'submit_spec_site', input }], usage };
}

function mockImageResult(costUsd = 0.01) {
  return {
    buffer: Buffer.from('fake-image-bytes'),
    contentType: 'image/jpeg',
    size: 16,
    model: 'imagen-4.0-fast-generate-001',
    provider: 'google' as const,
    costUsd,
  };
}

/** Pull the buildsellSite doc-root createOrReplace payload out of the tx mock. */
function mainDocWrite(): Record<string, unknown> | undefined {
  const call = mockTxCreateOrReplace.mock.calls.find(
    ([doc]) => (doc as Record<string, unknown>)['_type'] === 'buildsellSite',
  );
  return call?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  mockSiteRow = null;
  mockSameMarketCount = 1;
  mockKlaviyoRow = null;
  updateCalls.length = 0;

  delete process.env.MOCK_AI;
  delete process.env.BUILDSELL_PER_RUN_CAP_USD;
  delete process.env.KLAVIYO_PRIVATE_API_KEY;
  delete process.env.SPEC_SITE_BUILDER_MODEL;
  delete process.env.ANTHROPIC_MODEL;

  vi.clearAllMocks();
  mockEstimateCostUsd.mockReturnValue(0.01);
  mockGetDocument.mockResolvedValue(null);
  mockTxCommit.mockResolvedValue({ transactionId: 'txn-mock-1' });
  mockGenerateHeroImageBuffer.mockResolvedValue(mockImageResult());
  mockUploadHeroImage.mockImplementation(async (_siteId: string, _buf: Buffer, filename: string, contentType: string) => ({
    assetId: `asset-${filename}`,
    url: `https://cdn.example/${filename}`,
    size: 100,
    contentType,
  }));
  mockGenerateAndUploadFavicon.mockResolvedValue({
    assetId: 'favicon-asset-1',
    url: 'https://cdn.example/favicon.svg',
    size: 50,
  });
});

afterEach(() => {
  vi.resetModules();
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('SpecSiteBuilder dedupeKeyFn', () => {
  it('bs:<buildsell_site_id>:<build_epoch>', async () => {
    const { agent } = await getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { buildsell_site_id: string; build_epoch: string }) => string }).dedupeKeyFn!;
    expect(fn({ buildsell_site_id: SITE_ID, build_epoch: 'epoch-7' })).toBe(`bs:${SITE_ID}:epoch-7`);
  });
});

// ── Guards ───────────────────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — guards', () => {
  it('throws when the buildsell_sites row does not exist; zero external calls', async () => {
    const { execute } = await getAgent();
    mockSiteRow = null;
    const ctx = makeCtx();
    await expect(
      execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx),
    ).rejects.toThrow(new RegExp(`buildsell_sites row not found: ${SITE_ID}`));

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockGenerateHeroImageBuffer).not.toHaveBeenCalled();
    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('refuses to rebuild a "paid" site without force_rebuild — RebuildProtectedError, ZERO db writes, ZERO paid calls', async () => {
    const { execute, agent } = await getAgent();
    const { RebuildProtectedError } = (await import('./index')) as unknown as { RebuildProtectedError: new (...a: unknown[]) => Error };
    void agent;
    mockSiteRow = makeSiteRow({ status: 'paid' });
    const ctx = makeCtx();

    await expect(execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx)).rejects.toThrow(RebuildProtectedError);

    expect(updateCalls).toHaveLength(0);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockGenerateHeroImageBuffer).not.toHaveBeenCalled();
    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
  });

  it('refuses to rebuild a "live" site without force_rebuild', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ status: 'live' });
    const ctx = makeCtx();
    await expect(execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx)).rejects.toThrow(/status is 'live'/);
    expect(updateCalls).toHaveLength(0);
  });

  it('force_rebuild:true bypasses the guard on a "paid" site and completes — but finalStatus lands "draft" (surprising: rebuild silently drops paid status)', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ status: 'paid' });
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1', force_rebuild: true }, ctx);

    const finalUpdate = updateCalls[updateCalls.length - 1]!;
    expect(finalUpdate['status']).toBe('draft');
  });

  it('REAL BUG: force_rebuild:true on a "live" site bypasses index.ts\'s guard, spends Anthropic + Imagen money, then fails at persist-sanity\'s independent siteStatus==="live" defense-in-depth check', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ status: 'live' });
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await expect(
      execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1', force_rebuild: true }, ctx),
    ).rejects.toThrow(/status is 'live'/);

    // Money was already spent before the second guard fired.
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalled();
    // The persist step never got as far as writing anything.
    expect(mockTxCreateOrReplace).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
    // Only the initial 'building' flip landed — the final status update never ran.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.['status']).toBe('building');
  });

  it('preserves "invoiced" status across a revise/rebuild', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow({ status: 'invoiced' });
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    const finalUpdate = updateCalls[updateCalls.length - 1]!;
    expect(finalUpdate['status']).toBe('invoiced');
  });
});

// ── Existing Sanity doc read ─────────────────────────────────────────────

describe('SpecSiteBuilder.execute — existing Sanity doc read', () => {
  it('a Sanity getDocument failure is non-fatal — the run still completes with defaults applied', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGetDocument.mockRejectedValue(new Error('sanity network error'));
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(result.doc_id).toBe(`bs-site-${SITE_ID}`);
    expect(ctx.log.warn).toHaveBeenCalled();
    const doc = mainDocWrite()!;
    expect(doc['draftMode']).toBe(true); // default applied — no existing doc to read from
  });

  it('themeLocked:true on the existing doc forces preserve_theme even when the input payload omits it', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGetDocument.mockResolvedValue({
      themeLocked: true,
      theme: {
        preset: 'Forest Pro',
        layoutVariant: 'trust',
        fontHeading: 'Sora',
        fontBody: 'Manrope',
        primary: { hex: '#15803d' },
      },
      sections: [],
    });
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    // mockSameMarketCount=1 → rotation would normally pick 'Aqua Slate' /
    // 'split' — the existing (locked) theme must win instead.
    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    const doc = mainDocWrite()!;
    const theme = doc['theme'] as Record<string, unknown>;
    expect(theme['preset']).toBe('Forest Pro');
    expect(theme['layoutVariant']).toBe('trust');
    expect(theme['fontHeading']).toBe('Sora');
  });

  it('migrated hero/about image ids AND a migrated logo skip Imagen + favicon generation entirely (money guard)', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGetDocument.mockResolvedValue({
      migrated: {
        heroImageAssetId: 'image-migrated-hero',
        aboutImageAssetId: 'image-migrated-about',
        logoAssetId: 'image-migrated-logo',
        source: 'content-migrator',
      },
      sections: [],
    });
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    // Hero + about are migrated → generateHeroImageBuffer is only called for
    // the OG image (no migration overlay exists for og).
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(1);
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledWith(content.seo.ogImagePrompt, { aspectRatio: '1:1' });
    // Favicon generation skipped — migrated logo used instead.
    expect(mockGenerateAndUploadFavicon).not.toHaveBeenCalled();
    expect(result.hero_image).toBe(true);
  });
});

// ── Content generation ───────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — content generation', () => {
  it('calls Claude with the default model, submit_spec_site tool, and rotation directives in the prompt', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    const call = mockAnthropicCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(call['model']).toBe('claude-sonnet-4-6');
    expect(call['tool_choice']).toEqual({ type: 'tool', name: 'submit_spec_site' });
    const tools = call['tools'] as Array<Record<string, unknown>>;
    expect(tools[0]?.['name']).toBe('submit_spec_site');
    const userPrompt = (call['messages'] as Array<{ content: string }>)[0]!.content;
    expect(userPrompt).toContain('Business name: Acme Plumbing');
    expect(userPrompt).toContain('## Rotation directives');
    expect(userPrompt).toContain('theme.layoutVariant: split');
  });

  it('honors SPEC_SITE_BUILDER_MODEL over ANTHROPIC_MODEL over the hardcoded default', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-should-not-win';
    process.env.SPEC_SITE_BUILDER_MODEL = 'claude-spec-site-override';
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect((mockAnthropicCreate.mock.calls[0]![0] as Record<string, unknown>)['model']).toBe('claude-spec-site-override');
  });

  it('includes the clarifying_prompt in the user prompt when provided; omits the section otherwise', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute(
      { buildsell_site_id: SITE_ID, build_epoch: 'e1', clarifying_prompt: 'UNIQUE_CLARIFY_MARKER_XYZ' },
      ctx,
    );

    const userPrompt = (mockAnthropicCreate.mock.calls[0]![0] as { messages: Array<{ content: string }> })
      .messages[0]!.content;
    expect(userPrompt).toContain('UNIQUE_CLARIFY_MARKER_XYZ');
    expect(userPrompt).toContain('Operator refinement hint');
  });

  it('throws when Claude does not return a tool_use block — zero images/klaviyo/sanity calls', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I refuse to use the tool.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const ctx = makeCtx();

    await expect(execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx)).rejects.toThrow(
      /did not return tool_use/,
    );

    expect(mockGenerateHeroImageBuffer).not.toHaveBeenCalled();
    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
    // Only the 'building' flip landed.
    expect(updateCalls).toHaveLength(1);
  });
});

// ── Lint retry ───────────────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — lint violation retry', () => {
  it('a clean first pass never triggers a retry', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  it('a violating first pass retries once; an improved retry is used', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const violating = buildContent({ services: { heading: 'Our Services', cards: buildContent().services.cards } });
    const clean = buildContent();
    mockAnthropicCreate
      .mockResolvedValueOnce(toolUseResponse(violating))
      .mockResolvedValueOnce(toolUseResponse(clean));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    const retryPrompt = (mockAnthropicCreate.mock.calls[1]![0] as { messages: Array<{ content: string }> })
      .messages[0]!.content;
    expect(retryPrompt).toContain('Previous output failed lint');
    expect(retryPrompt).toContain('hardcoded heading "Our Services"');

    const doc = mainDocWrite()!;
    const services = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'services')!;
    expect(services['heading']).toBe('What We Do'); // the clean retry's heading, not "Our Services"
  });

  it('a retry that does NOT improve falls back to the first pass (still violating) without throwing', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const violating = buildContent({ services: { heading: 'Our Services', cards: buildContent().services.cards } });
    const stillViolating = buildContent({
      services: { heading: 'Our Services', cards: buildContent().services.cards },
      about: { ...buildContent().about, heading: 'Different Heading' },
    });
    mockAnthropicCreate
      .mockResolvedValueOnce(toolUseResponse(violating))
      .mockResolvedValueOnce(toolUseResponse(stillViolating));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    const doc = mainDocWrite()!;
    const about = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'about')!;
    // First-pass about.heading used (not the retry's "Different Heading"),
    // proving the retry's output was discarded when it didn't improve.
    expect(about['heading']).toBe('Your Local Plumbing Experts');
  });

  it('a retry that throws is caught — falls back to the first pass, run still completes', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const violating = buildContent({ services: { heading: 'Our Services', cards: buildContent().services.cards } });
    mockAnthropicCreate
      .mockResolvedValueOnce(toolUseResponse(violating))
      .mockRejectedValueOnce(new Error('anthropic 529 overloaded'));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(result.doc_id).toBe(`bs-site-${SITE_ID}`);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    const doc = mainDocWrite()!;
    const services = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'services')!;
    expect(services['heading']).toBe('Our Services'); // first-pass content used despite the violation
  });
});

// ── Per-run cost cap (money guard) ────────────────────────────────────────

describe('SpecSiteBuilder.execute — per-run cost cap', () => {
  it('throws BudgetExceededError right after content generation when over cap — no images, no favicon, no Klaviyo, no Sanity write', async () => {
    process.env.BUILDSELL_PER_RUN_CAP_USD = '0.10';
    mockEstimateCostUsd.mockReturnValue(5.0); // way over the $0.10 cap
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await expect(execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx)).rejects.toThrow(
      /exceeded its budget cap of \$0\.10/,
    );

    expect(mockGenerateHeroImageBuffer).not.toHaveBeenCalled();
    expect(mockGenerateAndUploadFavicon).not.toHaveBeenCalled();
    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    expect(mockTxCommit).not.toHaveBeenCalled();
    // Only the 'building' flip landed.
    expect(updateCalls).toHaveLength(1);
  });

  it('exactly-at-cap is treated as UNDER cap (spentThisRun <= perRunCap) — the run proceeds', async () => {
    process.env.BUILDSELL_PER_RUN_CAP_USD = '0.05';
    mockEstimateCostUsd.mockReturnValue(0.05);
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);
    expect(result.doc_id).toBeDefined();
  });

  it('DOCUMENTED GAP: a cap blown only during the lint-retry pass is NOT re-checked by assertUnderCap (only called once) — but per-step underCap() gates still skip later image spend', async () => {
    process.env.BUILDSELL_PER_RUN_CAP_USD = '0.10';
    // First pass cheap (under cap, passes assertUnderCap); retry alone blows way past cap.
    mockEstimateCostUsd.mockReturnValueOnce(0.01).mockReturnValueOnce(5.0);
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const violating = buildContent({ services: { heading: 'Our Services', cards: buildContent().services.cards } });
    const retried = buildContent();
    mockAnthropicCreate
      .mockResolvedValueOnce(toolUseResponse(violating))
      .mockResolvedValueOnce(toolUseResponse(retried));
    const ctx = makeCtx();

    // Does NOT throw BudgetExceededError even though spentThisRun is now $5.01 —
    // assertUnderCap() only runs once, before the retry.
    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);
    expect(result.doc_id).toBeDefined();

    // But the per-step underCap() gate still protects image spend: hero is
    // never generated because spentThisRun is already far over cap.
    expect(mockGenerateHeroImageBuffer).not.toHaveBeenCalled();
  });
});

// ── Hero / about / og image gating ────────────────────────────────────────

describe('SpecSiteBuilder.execute — image generation gating', () => {
  it('happy path: hero/about/og all generated with the right prompts/aspect ratios and uploaded with distinct filenames', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(3);
    expect(mockGenerateHeroImageBuffer).toHaveBeenNthCalledWith(1, content.hero.imagePrompt, { aspectRatio: '16:9' });
    expect(mockGenerateHeroImageBuffer).toHaveBeenNthCalledWith(2, content.about.imagePrompt, { aspectRatio: '4:3' });
    expect(mockGenerateHeroImageBuffer).toHaveBeenNthCalledWith(3, content.seo.ogImagePrompt, { aspectRatio: '1:1' });

    expect(mockUploadHeroImage).toHaveBeenCalledWith(SITE_ID, expect.any(Buffer), `bs-hero-${SITE_ID}.jpg`, 'image/jpeg');
    expect(mockUploadHeroImage).toHaveBeenCalledWith(SITE_ID, expect.any(Buffer), `bs-about-${SITE_ID}.jpg`, 'image/jpeg');
    expect(mockUploadHeroImage).toHaveBeenCalledWith(SITE_ID, expect.any(Buffer), `bs-og-${SITE_ID}.jpg`, 'image/jpeg');
    expect(result.hero_image).toBe(true);
  });

  it('about image is skipped when content has no about.imagePrompt — regardless of cap', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const content = buildContent({ about: { ...buildContent().about, imagePrompt: undefined } });
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    // hero + og only — about is skipped.
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(2);
    const aspectRatios = mockGenerateHeroImageBuffer.mock.calls.map((c) => (c[1] as { aspectRatio: string }).aspectRatio);
    expect(aspectRatios).not.toContain('4:3');
  });

  it('og image is skipped when content has no seo.ogImagePrompt', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const content = buildContent({ seo: { ...buildContent().seo, ogImagePrompt: undefined } });
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    const aspectRatios = mockGenerateHeroImageBuffer.mock.calls.map((c) => (c[1] as { aspectRatio: string }).aspectRatio);
    expect(aspectRatios).not.toContain('1:1');
  });

  it('a hero image generation failure is non-fatal — heroImageAssetId stays null, the run still completes', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGenerateHeroImageBuffer.mockRejectedValueOnce(new Error('imagen 500'));
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(result.hero_image).toBe(false);
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it('imagen returning null (no provider configured) is a safe no-op — no upload attempted', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGenerateHeroImageBuffer.mockResolvedValue(null);
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockUploadHeroImage).not.toHaveBeenCalled();
    expect(result.hero_image).toBe(false);
  });

  it('an exhausted cap after the hero image skips BOTH the about and og image generation', async () => {
    process.env.BUILDSELL_PER_RUN_CAP_USD = '0.05';
    mockEstimateCostUsd.mockReturnValue(0.05); // content spend exactly at cap
    mockGenerateHeroImageBuffer.mockResolvedValueOnce(mockImageResult(1.0)); // blows the cap
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(1); // hero only
    expect(result.hero_image).toBe(true);
    const doc = mainDocWrite()!;
    const about = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'about')!;
    expect((about['image'] as Record<string, unknown> | undefined)).toBeUndefined();
  });
});

// ── Trust-layout hero strip ────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — trust-layout hero strip', () => {
  it('generates 2 extra strip tiles ONLY for layoutVariant==="trust" with a successful hero image', async () => {
    mockSameMarketCount = 3; // rotationSeed(2) → LAYOUT_VARIANTS[2] === 'trust'
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    const content = buildContent();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(content));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    // hero + about + og + stripB + stripC = 5 calls total.
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(5);
    const prompts = mockGenerateHeroImageBuffer.mock.calls.map((c) => c[0] as string);
    expect(prompts).toContain(`${content.hero.imagePrompt}. Alternate angle, different composition.`);
    expect(prompts).toContain(`${content.hero.imagePrompt}. Close-up detail shot.`);

    const doc = mainDocWrite()!;
    const hero = (doc['sections'] as Array<Record<string, unknown>>).find((s) => s['_key'] === 'hero')!;
    expect(hero['imageB']).toBeDefined();
    expect(hero['imageC']).toBeDefined();
  });

  it('does NOT generate strip tiles for a non-trust layout', async () => {
    mockSameMarketCount = 1; // rotationSeed(0) → LAYOUT_VARIANTS[0] === 'split'
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(3); // hero + about + og only
  });

  it('stops the strip loop mid-way when the cap is exhausted by tile B', async () => {
    mockSameMarketCount = 3; // trust layout
    process.env.BUILDSELL_PER_RUN_CAP_USD = '1.00';
    mockEstimateCostUsd.mockReturnValue(0.01);
    mockGenerateHeroImageBuffer
      .mockResolvedValueOnce(mockImageResult(0.01)) // hero
      .mockResolvedValueOnce(mockImageResult(0.01)) // about
      .mockResolvedValueOnce(mockImageResult(0.01)) // og
      .mockResolvedValueOnce(mockImageResult(5.0)); // strip tile B — blows the cap
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    // hero + about + og + stripB = 4 calls; stripC never attempted.
    expect(mockGenerateHeroImageBuffer).toHaveBeenCalledTimes(4);
  });
});

// ── Favicon ──────────────────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — favicon', () => {
  it('generates a favicon from the RESOLVED theme preset colors (Aqua Slate → primary/onPrimary)', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockGenerateAndUploadFavicon).toHaveBeenCalledWith(SITE_ID, 'Acme Plumbing', {
      bgHex: '#0d9488',
      fgHex: '#ffffff',
    });
  });

  it('a favicon generation failure is non-fatal — faviconAssetId stays unset, the run still completes', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockGenerateAndUploadFavicon.mockRejectedValueOnce(new Error('sanity upload failed'));
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(result.doc_id).toBeDefined();
    expect(ctx.log.warn).toHaveBeenCalled();
    const doc = mainDocWrite()!;
    expect(doc['favicon']).toBeUndefined();
  });
});

// ── Klaviyo ──────────────────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — Klaviyo list provisioning', () => {
  it('KLAVIYO_PRIVATE_API_KEY unset → createList never called, zero klaviyo DB lookups needed', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    const doc = mainDocWrite()!;
    expect(doc['klaviyoListId']).toBeUndefined();
    void result;
  });

  it('already-provisioned list (existing klaviyoListId row) is reused idempotently — createList never called', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'test-key';
    mockKlaviyoRow = { klaviyoListId: 'list-already-provisioned' };
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockKlaviyoCreateList).not.toHaveBeenCalled();
    const doc = mainDocWrite()!;
    expect(doc['klaviyoListId']).toBe('list-already-provisioned');
  });

  it('no existing list → createList called with the expected list name; DB update sets klaviyoListId; doc carries it', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'test-key';
    mockKlaviyoRow = null;
    mockKlaviyoCreateList.mockResolvedValue({ listId: 'list-freshly-created' });
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(mockKlaviyoCreateList).toHaveBeenCalledWith('B&S · Acme Plumbing (Austin, TX)');
    expect(updateCalls.some((c) => c['klaviyoListId'] === 'list-freshly-created')).toBe(true);
    const doc = mainDocWrite()!;
    expect(doc['klaviyoListId']).toBe('list-freshly-created');
  });

  it('createList failure is non-fatal — proceeds without a list id, no DB update for it', async () => {
    process.env.KLAVIYO_PRIVATE_API_KEY = 'test-key';
    mockKlaviyoRow = null;
    mockKlaviyoCreateList.mockRejectedValue(new Error('klaviyo 500'));
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);

    expect(result.doc_id).toBeDefined();
    expect(updateCalls.some((c) => 'klaviyoListId' in c)).toBe(false);
    const doc = mainDocWrite()!;
    expect(doc['klaviyoListId']).toBeUndefined();
  });
});

// ── Output shape + slug ───────────────────────────────────────────────────

describe('SpecSiteBuilder.execute — output shape', () => {
  it('slug is slugify(businessName)-slugify(city)-state-id6; output matches SpecSiteBuilderOutput', async () => {
    const { execute } = await getAgent();
    mockSiteRow = makeSiteRow();
    mockAnthropicCreate.mockResolvedValueOnce(toolUseResponse(buildContent()));
    const ctx = makeCtx();

    const result = await execute({ buildsell_site_id: SITE_ID, build_epoch: 'e1' }, ctx);
    const { SpecSiteBuilderOutput } = await import('./schema');

    expect(result.slug).toBe(`acme-plumbing-austin-tx-${SITE_ID.slice(0, 6)}`);
    expect(SpecSiteBuilderOutput.safeParse(result).success).toBe(true);
    expect(result.sections).toBe(7); // hero/services/about/process/reviews/contact/footer
    expect(typeof result.cost_usd).toBe('number');
  });
});
