/**
 * Tests for MollyCopywriter — drafts a guest post once a target editor has
 * accepted Molly's pitch (ADR-0006: accepted → drafting → draft_pending_review).
 *
 * All external effects are mocked: DB (@leadlandlord/db), the Anthropic SDK
 * (@leadlandlord/integrations/anthropic — used for both the Haiku voice pre-
 * pass and the Sonnet draft), Firecrawl (@leadlandlord/integrations/firecrawl),
 * and `pickAnchor` from ../seo-expert/anchor-policy (which has its own
 * dedicated test suite — mocked here to isolate MollyCopywriter's own logic
 * from anchor selection). This suite never touches a real API or DB.
 *
 * `MollyCopywriterInput`/`MollyCopywriterOutput` are not exported from the
 * source module, so this suite drives the agent through its public surface
 * (`new MollyCopywriter()` + the protected `execute()`, matching the
 * established sibling-test pattern of casting to call `execute` directly)
 * and asserts on the returned object's shape explicitly rather than via
 * `.safeParse()`.
 *
 * Covered:
 *  - status guard: row.status !== 'accepted' → skipped_wrong_status, zero
 *    DB writes, pickAnchor never called
 *  - already-drafted guard: draftMarkdown already set → skipped_already_drafted,
 *    reuses row.anchorType, zero DB writes
 *  - backlink / site not-found guards throw with the expected message
 *  - happy path (voice cache hit): flips to 'drafting' first, skips
 *    Firecrawl + Haiku entirely, drafts via Sonnet, persists
 *    draft_pending_review with the full metadata bag, and returns
 *    'drafted' with the anchor/word-count/paragraph-index/voiceSource
 *  - happy path (voice cache miss → Firecrawl scrape → Haiku extraction):
 *    calls Haiku once for the voice pre-pass, then Sonnet for the draft
 *    (two distinct recordUsage calls), and caches the extracted voice back
 *    onto backlinkProspects.metadata.targetVoice
 *  - voice fallback: no cache + no usable scrape (null or <200 chars) →
 *    neutral fallback notes, no Haiku call, no caching write
 *  - voice fallback via Haiku failure: scrape succeeds but the Haiku call
 *    throws → falls back, and the run still completes via Sonnet
 *  - no prospect row at all → loadVoice still runs (prospectId=null),
 *    falls back safely
 *  - Sonnet returning an empty draft throws and stops before the final
 *    persist write (only the 'drafting' flip landed)
 *  - findAnchorParagraphIndex returns 0 when the anchor text isn't found
 *    in the drafted markdown
 *  - the per-bucket ANCHOR_INSTRUCTIONS fragment and voice notes are both
 *    wired into the Sonnet system prompt (a copy/paste swap here would be
 *    a silent regression with no test signal otherwise)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext } from '../base';

const BACKLINK_ID = '77777777-7777-7777-7777-777777777777';
const SITE_ID = '88888888-8888-8888-8888-888888888888';
const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const PROSPECT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const COPYWRITER_MODEL = 'claude-sonnet-4-6';
const VOICE_MODEL = 'claude-haiku-4-5';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockBacklinkRow: Record<string, unknown> | null = null;
let mockSiteRow: Record<string, unknown> | null = null;
let mockTenantRow: Record<string, unknown> | null = null;
let mockProspectRow: Record<string, unknown> | null = null;
const backlinksUpdateCalls: Array<Record<string, unknown>> = [];
const prospectsUpdateCalls: Array<Record<string, unknown>> = [];

vi.mock('@leadlandlord/db', () => {
  const backlinksTable = { __table: 'backlinks', id: 'id' };
  const backlinkProspectsTable = { __table: 'backlinkProspects', id: 'id', backlinkId: 'backlinkId' };
  const sitesTable = { __table: 'sites', id: 'id', tenantId: 'tenantId' };
  const tenantsTable = { __table: 'tenants', id: 'id' };

  let currentTable = '';
  const db = {
    select: () => db,
    from: (table: { __table: string }) => {
      currentTable = table.__table;
      return db;
    },
    where: () => db,
    limit: async () => {
      if (currentTable === 'backlinks') return mockBacklinkRow ? [mockBacklinkRow] : [];
      if (currentTable === 'sites') return mockSiteRow ? [mockSiteRow] : [];
      if (currentTable === 'tenants') return mockTenantRow ? [mockTenantRow] : [];
      if (currentTable === 'backlinkProspects') return mockProspectRow ? [mockProspectRow] : [];
      return [];
    },
    update: (table: { __table: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          if (table.__table === 'backlinks') backlinksUpdateCalls.push(vals);
          if (table.__table === 'backlinkProspects') prospectsUpdateCalls.push(vals);
        },
      }),
    }),
  };

  return {
    getDb: () => db,
    backlinks: backlinksTable,
    backlinkProspects: backlinkProspectsTable,
    sites: sitesTable,
    tenants: tenantsTable,
  };
});

// ── Anthropic (Haiku voice pre-pass + Sonnet draft) ────────────────────────
const mockCreate = vi.fn();
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  estimateCostUsd: () => 0.0025,
}));

// ── Firecrawl ────────────────────────────────────────────────────────────
const mockScrapeUrlMarkdown = vi.fn();
vi.mock('@leadlandlord/integrations/firecrawl', () => ({
  scrapeUrlMarkdown: (...args: unknown[]) => mockScrapeUrlMarkdown(...args),
}));

// ── Anchor policy (own dedicated test suite — mocked here) ─────────────────
const mockPickAnchor = vi.fn();
vi.mock('../seo-expert/anchor-policy', () => ({
  pickAnchor: (...args: unknown[]) => mockPickAnchor(...args),
}));

function textResponse(text: string, usage = { input_tokens: 500, output_tokens: 300 }) {
  return { content: [{ type: 'text', text }], usage };
}

const DRAFT_MARKDOWN = [
  'This is the opening paragraph with a concrete anecdote about a leaky roof.',
  '## Section one\n\nSome practical advice for homeowners in the area.',
  '## Section two\n\nMore advice, and here is the link to Acme Roofing for a free quote.',
  '## Section three\n\nA closing practical takeaway for the reader.',
].join('\n\n');

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: vi.fn(),
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext & { recordUsage: ReturnType<typeof vi.fn> };

async function getAgent() {
  const { MollyCopywriter } = await import('./index');
  const agent = new MollyCopywriter();
  const execute = (input: { backlinkId: string }, ctx: AgentContext) =>
    (agent as unknown as { execute: (i: unknown, c: AgentContext) => Promise<Record<string, unknown>> }).execute(
      input,
      ctx,
    );
  return { agent, execute };
}

function makeBacklinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BACKLINK_ID,
    siteId: SITE_ID,
    sourceDomain: 'targetblog.com',
    status: 'accepted',
    draftMarkdown: null,
    anchorType: null,
    metadata: {},
    ...overrides,
  };
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SITE_ID,
    tenantId: TENANT_ID,
    niche: 'roofing',
    city: 'Austin',
    state: 'TX',
    domain: 'acmeroofing.com',
    ...overrides,
  };
}

function makeAnchorPick(overrides: Record<string, unknown> = {}) {
  return {
    type: 'branded',
    text: 'Acme Roofing',
    distribution: { branded: 0.5, naked: 0.25, generic: 0.15, partial: 0.1 },
    total: 4,
    ...overrides,
  };
}

beforeEach(() => {
  mockBacklinkRow = null;
  mockSiteRow = null;
  mockTenantRow = null;
  mockProspectRow = null;
  backlinksUpdateCalls.length = 0;
  prospectsUpdateCalls.length = 0;
  mockCreate.mockReset();
  mockScrapeUrlMarkdown.mockReset();
  mockPickAnchor.mockReset();
  (NOOP_CTX.recordUsage as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  vi.resetModules();
});

// ── Status guards ────────────────────────────────────────────────────────

describe('MollyCopywriter.execute — guards', () => {
  it('throws when the backlink does not exist', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = null;
    await expect(execute({ backlinkId: BACKLINK_ID }, NOOP_CTX)).rejects.toThrow(
      new RegExp(`backlink ${BACKLINK_ID} not found`),
    );
  });

  it('status !== accepted → skipped_wrong_status, no DB writes, pickAnchor never called', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow({ status: 'submitted' });

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result).toEqual({
      backlinkId: BACKLINK_ID,
      status: 'skipped_wrong_status',
      anchorType: null,
      anchorText: null,
      draftWordCount: null,
      anchorParagraphIndex: null,
      voiceSource: null,
    });
    expect(backlinksUpdateCalls).toHaveLength(0);
    expect(mockPickAnchor).not.toHaveBeenCalled();
  });

  it('draftMarkdown already present → skipped_already_drafted, reuses row.anchorType, no writes', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow({ draftMarkdown: '# Already drafted', anchorType: 'naked' });

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result).toEqual({
      backlinkId: BACKLINK_ID,
      status: 'skipped_already_drafted',
      anchorType: 'naked',
      anchorText: null,
      draftWordCount: null,
      anchorParagraphIndex: null,
      voiceSource: null,
    });
    expect(backlinksUpdateCalls).toHaveLength(0);
    expect(mockPickAnchor).not.toHaveBeenCalled();
  });

  it('site not found → throws with the backlink id in the message', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = null;

    await expect(execute({ backlinkId: BACKLINK_ID }, NOOP_CTX)).rejects.toThrow(
      new RegExp(`site ${SITE_ID} not found for backlink ${BACKLINK_ID}`),
    );
    // The 'drafting' flip happens before the site lookup, so exactly one write landed.
    expect(backlinksUpdateCalls).toHaveLength(1);
    expect(backlinksUpdateCalls[0]).toEqual({ status: 'drafting' });
  });
});

// ── Happy path: voice cache hit ─────────────────────────────────────────

describe('MollyCopywriter.execute — happy path (voice cache hit)', () => {
  it('flips to drafting, skips Firecrawl+Haiku, drafts via Sonnet, persists draft_pending_review', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow({ metadata: { pitchTopic: 'roof maintenance checklist' } });
    mockSiteRow = makeSiteRow();
    mockTenantRow = { id: TENANT_ID, businessName: 'Acme Roofing' };
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: { targetVoice: 'Casual, second-person, short sentences.' } };
    mockPickAnchor.mockResolvedValue(makeAnchorPick({ type: 'branded', text: 'Acme Roofing' }));
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    // Cache hit — no scrape, no Haiku call, exactly one Sonnet call.
    expect(mockScrapeUrlMarkdown).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0]![0]).toMatchObject({ model: COPYWRITER_MODEL });
    expect((NOOP_CTX.recordUsage as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    // pickAnchor called with the backlink's siteId.
    expect(mockPickAnchor).toHaveBeenCalledWith(SITE_ID);

    // First write flips to drafting; second persists the draft.
    expect(backlinksUpdateCalls).toHaveLength(2);
    expect(backlinksUpdateCalls[0]).toEqual({ status: 'drafting' });
    const persisted = backlinksUpdateCalls[1]!;
    expect(persisted.status).toBe('draft_pending_review');
    expect(persisted.draftMarkdown).toBe(DRAFT_MARKDOWN);
    expect(persisted.anchorType).toBe('branded');
    const meta = persisted.metadata as Record<string, unknown>;
    expect(meta.anchorText).toBe('Acme Roofing');
    expect(meta.voiceSource).toBe('cache');
    expect(meta.draftWordCount).toBeGreaterThan(0);
    expect(typeof meta.draftedAt).toBe('string');
    expect(meta.anchorDistribution).toEqual(makeAnchorPick().distribution);

    // Result shape.
    expect(result).toEqual({
      backlinkId: BACKLINK_ID,
      status: 'drafted',
      anchorType: 'branded',
      anchorText: 'Acme Roofing',
      draftWordCount: meta.draftWordCount,
      anchorParagraphIndex: meta.anchorParagraphIndex,
      voiceSource: 'cache',
    });

    // findAnchorParagraphIndex splits on \n{2,} (so each "## Heading" line is
    // its own block, separate from the prose under it): [0] opener,
    // [1] "## Section one", [2] its prose, [3] "## Section two",
    // [4] its prose (contains "Acme Roofing" — where the anchor was planted),
    // [5] "## Section three", [6] its prose. 1-indexed → 5.
    expect(result.anchorParagraphIndex).toBe(5);
  });

  it('wires the per-bucket ANCHOR_INSTRUCTIONS fragment and voice notes into the Sonnet system prompt', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockTenantRow = { id: TENANT_ID, businessName: 'Acme Roofing' };
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: { targetVoice: 'UNIQUE_VOICE_MARKER_XYZ' } };
    mockPickAnchor.mockResolvedValue(makeAnchorPick({ type: 'naked', text: 'https://acmeroofing.com' }));
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    const systemPrompt = mockCreate.mock.calls[0]![0].system as string;
    expect(systemPrompt).toContain('UNIQUE_VOICE_MARKER_XYZ');
    expect(systemPrompt).toContain('Plant the URL https://acmeroofing.com once');
  });
});

// ── Happy path: voice cache miss → Firecrawl → Haiku ────────────────────

describe('MollyCopywriter.execute — happy path (voice cache miss, Firecrawl + Haiku)', () => {
  it('scrapes the target, extracts voice via Haiku, caches it, then drafts via Sonnet', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow({ sourceDomain: 'https://targetblog.com/' });
    mockSiteRow = makeSiteRow();
    mockTenantRow = { id: TENANT_ID, businessName: 'Acme Roofing' };
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: {} };
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockScrapeUrlMarkdown.mockResolvedValue('A'.repeat(500));
    mockCreate
      .mockResolvedValueOnce(textResponse('- Short sentences\n- Second person\n- No fluff'))
      .mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    // Scrape hit the protocol-stripped, trailing-slash-stripped homepage.
    expect(mockScrapeUrlMarkdown).toHaveBeenCalledWith('https://targetblog.com');

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0]![0]).toMatchObject({ model: VOICE_MODEL });
    expect(mockCreate.mock.calls[1]![0]).toMatchObject({ model: COPYWRITER_MODEL });
    expect((NOOP_CTX.recordUsage as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);

    // Cached back onto the prospect row, merged with existing metadata.
    expect(prospectsUpdateCalls).toHaveLength(1);
    expect((prospectsUpdateCalls[0]!.metadata as Record<string, unknown>).targetVoice).toBe(
      '- Short sentences\n- Second person\n- No fluff',
    );

    expect(result.voiceSource).toBe('firecrawl');
  });

  it('no cache + no usable scrape (null) → neutral fallback, no Haiku call, no caching write', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockTenantRow = null;
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: {} };
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockScrapeUrlMarkdown.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(mockCreate).toHaveBeenCalledTimes(1); // only the Sonnet draft call
    expect(mockCreate.mock.calls[0]![0]).toMatchObject({ model: COPYWRITER_MODEL });
    expect(prospectsUpdateCalls).toHaveLength(0);
    expect(result.voiceSource).toBe('fallback');
  });

  it('no cache + short scrape (<200 chars) → neutral fallback', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: {} };
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockScrapeUrlMarkdown.mockResolvedValue('too short');
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.voiceSource).toBe('fallback');
  });

  it('scrape succeeds but the Haiku call throws → falls back, Sonnet draft still completes', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: {} };
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockScrapeUrlMarkdown.mockResolvedValue('A'.repeat(500));
    mockCreate
      .mockRejectedValueOnce(new Error('anthropic 529 overloaded'))
      .mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('drafted');
    expect(result.voiceSource).toBe('fallback');
    expect(prospectsUpdateCalls).toHaveLength(0);
  });

  it('no prospect row at all → loadVoice runs with prospectId=null, falls back safely', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockProspectRow = null;
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockScrapeUrlMarkdown.mockResolvedValue(null);
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.status).toBe('drafted');
    expect(result.voiceSource).toBe('fallback');
    expect(prospectsUpdateCalls).toHaveLength(0);
  });
});

// ── Guard rail: empty Sonnet draft ─────────────────────────────────────

describe('MollyCopywriter.execute — Sonnet returns an empty draft', () => {
  it('throws and never reaches the final persist write', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: { targetVoice: 'cached voice' } };
    mockPickAnchor.mockResolvedValue(makeAnchorPick());
    mockCreate.mockResolvedValueOnce(textResponse('   '));

    await expect(execute({ backlinkId: BACKLINK_ID }, NOOP_CTX)).rejects.toThrow(
      /Sonnet returned empty draft/,
    );

    // Only the 'drafting' flip landed — the final persist never ran.
    expect(backlinksUpdateCalls).toHaveLength(1);
    expect(backlinksUpdateCalls[0]).toEqual({ status: 'drafting' });
  });
});

// ── findAnchorParagraphIndex guard ──────────────────────────────────────

describe('MollyCopywriter.execute — anchor not found in the draft', () => {
  it('anchorParagraphIndex is 0 when the anchor text never appears in the markdown', async () => {
    const { execute } = await getAgent();
    mockBacklinkRow = makeBacklinkRow();
    mockSiteRow = makeSiteRow();
    mockProspectRow = { id: PROSPECT_ID, backlinkId: BACKLINK_ID, metadata: { targetVoice: 'cached voice' } };
    mockPickAnchor.mockResolvedValue(makeAnchorPick({ type: 'branded', text: 'Some Anchor Never In The Draft' }));
    mockCreate.mockResolvedValueOnce(textResponse(DRAFT_MARKDOWN));

    const result = await execute({ backlinkId: BACKLINK_ID }, NOOP_CTX);

    expect(result.anchorParagraphIndex).toBe(0);
  });
});
