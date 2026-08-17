/**
 * Tests for IndexNowSubmitter — pings Bing + Brave via the IndexNow protocol
 * when a site goes live or its content changes, generating + persisting a
 * per-site key to Sanity on first run. Every external surface (DB, Sanity,
 * the `submitUrls` integration, and the sitemap `fetch`) is mocked; this
 * suite never touches a real API or DB.
 *
 * Covered:
 *  - site not found → throws IntegrationError('indexnow', 'site not found: ...')
 *  - no domain attached (neither Postgres nor Sanity) → status
 *    'skipped_no_domain', submitUrls never called
 *  - host resolution precedence: Postgres siteRow.domain wins over Sanity;
 *    else Sanity isPrimary domain wins; else the first Sanity domain
 *  - key generation on first run: doc.indexnowKey absent → a new 32-hex key
 *    is generated and persisted via sanity.patch(docId).set({indexnowKey}).commit();
 *    doc.indexnowKey present → no patch call, existing key reused
 *  - URL set resolution: explicit input.urls used as-is (sitemap fetch never
 *    called); absent → fetchSitemapUrls(host) result used; sitemap yields
 *    nothing → falls back to [https://{host}/]
 *  - fetchSitemapUrls (not exported, driven indirectly via execute()): XML
 *    with <loc> entries → trimmed absolute-URL list; non-ok response and a
 *    thrown fetch both → [] → triggers the homepage fallback
 *  - submit outcomes: ok:true → status 'submitted'; ok:false/retryable:false
 *    → status 'rejected'; ok:false/retryable:true → throws IntegrationError
 *    (queue-reaper retry path), no output returned
 *  - dedupeKeyFn: delta (non-empty urls) → indexnow:delta:<site_id>:<hash>,
 *    stable regardless of URL order; activation (no urls) →
 *    indexnow:activated:<site_id>; the two forms are always distinct
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IndexNowSubmitter, IndexNowSubmitterInput, IndexNowSubmitterOutput } from './index';
import type { AgentContext } from '../base';

const SITE_ID = '77777777-7777-7777-7777-777777777777';

// ── Mutable mock state, reset in beforeEach ────────────────────────────────
let mockSiteRow: Record<string, unknown> | null = null;

vi.mock('@leadlandlord/db', () => {
  const sitesTable = { __table: 'sites', id: 'id', domain: 'domain' };
  const db = {
    select: () => db,
    from: () => db,
    where: () => db,
    limit: async () => (mockSiteRow ? [mockSiteRow] : []),
  };
  return { getDb: () => db, sites: sitesTable };
});

// ── Sanity write client ─────────────────────────────────────────────────
const mockSanityFetch = vi.fn();
const mockSanityCommit = vi.fn().mockResolvedValue(undefined);
const mockSanitySet = vi.fn().mockReturnValue({ commit: mockSanityCommit });
const mockSanityPatch = vi.fn().mockReturnValue({ set: mockSanitySet });
const mockCreateWriteClient = vi.fn(() => ({ fetch: mockSanityFetch, patch: mockSanityPatch }));

vi.mock('@leadlandlord/integrations/sanity', () => ({
  createWriteClient: () => mockCreateWriteClient(),
  siteDocId: (id: string) => `site-${id}`,
}));

// ── IndexNow submission (real side effect) ──────────────────────────────
vi.mock('@leadlandlord/integrations/indexnow', () => ({
  submitUrls: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
} as unknown as AgentContext;

type Exec = (
  input: ReturnType<typeof IndexNowSubmitterInput.parse>,
  ctx: typeof NOOP_CTX,
) => Promise<typeof IndexNowSubmitterOutput._type>;

function getAgent() {
  const agent = new IndexNowSubmitter();
  const execute: Exec = (input, ctx) => (agent as unknown as { execute: Exec }).execute(input, ctx);
  return { agent, execute };
}

function makeSiteRow(overrides: Record<string, unknown> = {}) {
  return { id: SITE_ID, domain: null, ...overrides };
}

/** Sanity site doc shape as fetched by the agent. */
function makeSanityDoc(overrides: Record<string, unknown> = {}) {
  return { indexnowKey: null, domains: [], ...overrides };
}

beforeEach(async () => {
  mockSiteRow = null;
  vi.unstubAllGlobals();
  vi.clearAllMocks();

  mockSanityFetch.mockResolvedValue(makeSanityDoc());
  mockSanityCommit.mockResolvedValue(undefined);
  mockSanitySet.mockReturnValue({ commit: mockSanityCommit });
  mockSanityPatch.mockReturnValue({ set: mockSanitySet });

  const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
  vi.mocked(submitUrls).mockResolvedValue({ ok: true, retryable: false, submitted: 1, statusCode: 200 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── site not found ───────────────────────────────────────────────────────

describe('IndexNowSubmitter.execute — site not found', () => {
  it('throws IntegrationError when the site row does not exist', async () => {
    const { execute } = getAgent();
    mockSiteRow = null;

    await expect(execute({ site_id: SITE_ID } as never, NOOP_CTX)).rejects.toThrow(
      new RegExp(`site not found: ${SITE_ID}`),
    );
  });
});

// ── no domain attached ──────────────────────────────────────────────────

describe('IndexNowSubmitter.execute — no domain attached', () => {
  it('returns skipped_no_domain and never calls submitUrls when neither Postgres nor Sanity has a domain', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: null });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ domains: [] }));

    const result = await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    expect(result).toEqual({
      siteId: SITE_ID,
      host: null,
      submitted: 0,
      statusCode: 0,
      status: 'skipped_no_domain',
    });
    expect(submitUrls).not.toHaveBeenCalled();
  });

  it('also skips when the Sanity doc itself is null', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: null });
    mockSanityFetch.mockResolvedValue(null);

    const result = await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    expect(result.status).toBe('skipped_no_domain');
    expect(submitUrls).not.toHaveBeenCalled();
  });
});

// ── host resolution precedence ──────────────────────────────────────────

describe('IndexNowSubmitter.execute — host resolution precedence', () => {
  it('Postgres siteRow.domain wins over any Sanity domain', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'pg-domain.com' });
    mockSanityFetch.mockResolvedValue(
      makeSanityDoc({ indexnowKey: 'existingkey', domains: [{ host: 'sanity-domain.com', isPrimary: true }] }),
    );

    const result = await execute({ site_id: SITE_ID, urls: ['https://pg-domain.com/a'] } as never, NOOP_CTX);

    expect(result.host).toBe('pg-domain.com');
    expect(vi.mocked(submitUrls).mock.calls[0]?.[0]).toMatchObject({ host: 'pg-domain.com' });
  });

  it('falls back to the Sanity isPrimary domain when Postgres has none', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: null });
    mockSanityFetch.mockResolvedValue(
      makeSanityDoc({
        indexnowKey: 'existingkey',
        domains: [
          { host: 'secondary.com', isPrimary: false },
          { host: 'primary.com', isPrimary: true },
        ],
      }),
    );

    const result = await execute({ site_id: SITE_ID, urls: ['https://primary.com/a'] } as never, NOOP_CTX);

    expect(result.host).toBe('primary.com');
    expect(vi.mocked(submitUrls).mock.calls[0]?.[0]).toMatchObject({ host: 'primary.com' });
  });

  it('falls back to the first Sanity domain when none is marked isPrimary', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: null });
    mockSanityFetch.mockResolvedValue(
      makeSanityDoc({
        indexnowKey: 'existingkey',
        domains: [{ host: 'first.com', isPrimary: false }, { host: 'second.com', isPrimary: false }],
      }),
    );

    const result = await execute({ site_id: SITE_ID, urls: ['https://first.com/a'] } as never, NOOP_CTX);

    expect(result.host).toBe('first.com');
    expect(vi.mocked(submitUrls).mock.calls[0]?.[0]).toMatchObject({ host: 'first.com' });
  });
});

// ── key generation ───────────────────────────────────────────────────────

describe('IndexNowSubmitter.execute — key generation', () => {
  it('generates and persists a new 32-hex key when the Sanity doc has none', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: null, domains: [] }));

    await execute({ site_id: SITE_ID, urls: ['https://example.com/a'] } as never, NOOP_CTX);

    expect(mockSanityPatch).toHaveBeenCalledWith(`site-${SITE_ID}`);
    const setArg = mockSanitySet.mock.calls[0]?.[0] as { indexnowKey: string };
    expect(setArg.indexnowKey).toMatch(/^[0-9a-f]{32}$/);
    expect(mockSanityCommit).toHaveBeenCalledTimes(1);

    // The generated key is the one actually submitted.
    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { key: string };
    expect(submitArg.key).toBe(setArg.indexnowKey);
  });

  it('reuses an existing key without patching Sanity', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(
      makeSanityDoc({ indexnowKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', domains: [] }),
    );

    await execute({ site_id: SITE_ID, urls: ['https://example.com/a'] } as never, NOOP_CTX);

    expect(mockSanityPatch).not.toHaveBeenCalled();
    expect(mockSanityCommit).not.toHaveBeenCalled();
    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { key: string };
    expect(submitArg.key).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});

// ── URL set resolution ──────────────────────────────────────────────────

describe('IndexNowSubmitter.execute — URL set resolution', () => {
  it('uses input.urls as-is and never fetches the sitemap', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await execute(
      { site_id: SITE_ID, urls: ['https://example.com/a', 'https://example.com/b'] } as never,
      NOOP_CTX,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { urls: string[] };
    expect(submitArg.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('falls back to the live sitemap when input.urls is absent, parsing <loc> entries', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc> https://example.com/ </loc></url>
      <url><loc>https://example.com/services/</loc></url>
    </urlset>`;
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => xml });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/sitemap.xml',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.any(String) }) }),
    );
    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { urls: string[] };
    expect(submitArg.urls).toEqual(['https://example.com/', 'https://example.com/services/']);
  });

  it('falls back to the homepage URL when the sitemap response is non-ok', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, text: async () => '' });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { urls: string[] };
    expect(submitArg.urls).toEqual(['https://example.com/']);
  });

  it('falls back to the homepage URL when the sitemap fetch throws', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { urls: string[] };
    expect(submitArg.urls).toEqual(['https://example.com/']);
  });

  it('falls back to the homepage URL when the sitemap has no <loc> entries', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => '<urlset></urlset>' });
    vi.stubGlobal('fetch', fetchSpy);

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await execute({ site_id: SITE_ID } as never, NOOP_CTX);

    const submitArg = vi.mocked(submitUrls).mock.calls[0]?.[0] as { urls: string[] };
    expect(submitArg.urls).toEqual(['https://example.com/']);
  });
});

// ── submit outcomes ──────────────────────────────────────────────────────

describe('IndexNowSubmitter.execute — submit outcomes', () => {
  it('ok:true → status submitted, output mirrors submit result', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    vi.mocked(submitUrls).mockResolvedValue({ ok: true, retryable: false, submitted: 2, statusCode: 200 });

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    const result = await execute(
      { site_id: SITE_ID, urls: ['https://example.com/a', 'https://example.com/b'] } as never,
      NOOP_CTX,
    );

    expect(result).toEqual({
      siteId: SITE_ID,
      host: 'example.com',
      submitted: 2,
      statusCode: 200,
      status: 'submitted',
    });
  });

  it('ok:false, retryable:false → status rejected, no throw', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    vi.mocked(submitUrls).mockResolvedValue({ ok: false, retryable: false, submitted: 0, statusCode: 422 });

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    const result = await execute(
      { site_id: SITE_ID, urls: ['https://example.com/a'] } as never,
      NOOP_CTX,
    );

    expect(result).toEqual({
      siteId: SITE_ID,
      host: 'example.com',
      submitted: 0,
      statusCode: 422,
      status: 'rejected',
    });
  });

  it('ok:false, retryable:true → throws IntegrationError (queue reaper retry path), no output', async () => {
    const { submitUrls } = await import('@leadlandlord/integrations/indexnow');
    vi.mocked(submitUrls).mockResolvedValue({ ok: false, retryable: true, submitted: 0, statusCode: 503 });

    const { execute } = getAgent();
    mockSiteRow = makeSiteRow({ domain: 'example.com' });
    mockSanityFetch.mockResolvedValue(makeSanityDoc({ indexnowKey: 'existingkey' }));

    await expect(
      execute({ site_id: SITE_ID, urls: ['https://example.com/a'] } as never, NOOP_CTX),
    ).rejects.toThrow(/submit failed \(retryable\): 503 for example\.com/);
  });
});

// ── dedupeKeyFn ──────────────────────────────────────────────────────────

describe('IndexNowSubmitter dedupeKeyFn', () => {
  it('delta input (non-empty urls) → indexnow:delta:<site_id>:<hash>', () => {
    const { agent } = getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string; urls?: string[] }) => string | undefined })
      .dedupeKeyFn!;
    const key = fn({ site_id: SITE_ID, urls: ['https://example.com/a', 'https://example.com/b'] });
    expect(key).toMatch(new RegExp(`^indexnow:delta:${SITE_ID}:[0-9a-f]+$`));
  });

  it('delta key is stable regardless of URL order (sorted before hashing)', () => {
    const { agent } = getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string; urls?: string[] }) => string | undefined })
      .dedupeKeyFn!;
    const keyA = fn({ site_id: SITE_ID, urls: ['https://example.com/a', 'https://example.com/b'] });
    const keyB = fn({ site_id: SITE_ID, urls: ['https://example.com/b', 'https://example.com/a'] });
    expect(keyA).toBe(keyB);
  });

  it('a different URL set produces a different delta key', () => {
    const { agent } = getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string; urls?: string[] }) => string | undefined })
      .dedupeKeyFn!;
    const keyA = fn({ site_id: SITE_ID, urls: ['https://example.com/a'] });
    const keyB = fn({ site_id: SITE_ID, urls: ['https://example.com/c'] });
    expect(keyA).not.toBe(keyB);
  });

  it('activation input (no urls) → indexnow:activated:<site_id>', () => {
    const { agent } = getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string; urls?: string[] }) => string | undefined })
      .dedupeKeyFn!;
    expect(fn({ site_id: SITE_ID })).toBe(`indexnow:activated:${SITE_ID}`);
    expect(fn({ site_id: SITE_ID, urls: [] })).toBe(`indexnow:activated:${SITE_ID}`);
  });

  it('delta and activation keys are always distinct for the same site', () => {
    const { agent } = getAgent();
    const fn = (agent as unknown as { dedupeKeyFn: (i: { site_id: string; urls?: string[] }) => string | undefined })
      .dedupeKeyFn!;
    const deltaKey = fn({ site_id: SITE_ID, urls: ['https://example.com/a'] });
    const activationKey = fn({ site_id: SITE_ID });
    expect(deltaKey).not.toBe(activationKey);
  });
});
