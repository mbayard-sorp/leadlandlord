import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompetitorBrief, CompetitorAnalyzerInput } from './schema';

// Mock DB so tests don't need a real Postgres connection.
vi.mock('@leadlandlord/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'mock-run-id' }],
        onConflictDoUpdate: () => ({ returning: async () => [] }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {},
      }),
    }),
    execute: async () => {},
  }),
  agentRuns: {},
  agentBudgets: {},
  agentEvents: {},
  niches: {},
  getSystemState: async () => ({ killSwitch: false }),
}));

// Mock firecrawl so no HTTP calls are made.
vi.mock('@leadlandlord/integrations/firecrawl', () => ({
  scrapeUrlMarkdown: async (url: string) => {
    // Return short mock markdown -- never long prose that could leak.
    return `# Mock page for ${url}\n\nServices listed here.\n`;
  },
}));

// Mock SEMrush -- MOCK_AI flag is handled inside the integration itself,
// but we also mock the module to avoid cache/DB dependencies.
vi.mock('@leadlandlord/integrations/semrush', () => ({
  getDomainOrganicKeywords: async ({ domain }: { domain: string }) => [
    { keyword: `plumber near me ${domain}`, position: 1, volume: 900, cpc: 8.0, url: `https://${domain}/`, traffic_pct: 12, competition: 0.6 },
    { keyword: `drain cleaning ${domain}`, position: 3, volume: 400, cpc: 6.5, url: `https://${domain}/services/`, traffic_pct: 6, competition: 0.5 },
  ],
}));

// Mock the Anthropic client. Returns a valid CompetitorBrief tool-use response.
vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        content: [
          {
            type: 'tool_use',
            name: 'submit_competitor_brief',
            input: {
              analyzed_at: new Date().toISOString(),
              competitors: [
                { url: 'https://plumber-austin.com/', domain: 'plumber-austin.com', serp_rank: 1 },
              ],
              page_inventory: ['/services/drain-cleaning', '/service-areas/austin', '/faq'],
              topic_coverage: [
                { topic: 'emergency response', prevalence: 0.8 },
                { topic: 'financing options', prevalence: 0.4 },
              ],
              entities: ['WaterSense certified', 'Austin Water approved'],
              schema_types: ['LocalBusiness', 'FAQPage'],
              content_gaps: ['water heater rebates', 'trenchless sewer info'],
              structural_bar: {
                median_word_count: 650,
                has_faq: true,
                has_pricing: false,
                has_reviews: true,
              },
              keyword_opportunities: [
                { keyword: 'emergency plumber austin', volume: 880, ranked_by_competitors: 1 },
              ],
            },
          },
        ],
        usage: {
          input_tokens: 800,
          output_tokens: 300,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    },
  }),
  estimateCostUsd: () => 0.005,
}));

// ---------- helpers -----------------------------------------------------------

const NOOP_CTX = {
  runId: 'test-run',
  log: { info: () => {}, warn: () => {}, error: () => {} },
  parentRunId: null,
  recordUsage: () => {},
  progress: () => {},
  emitNextStepEvent: async () => {},
};

type Exec = (
  input: CompetitorAnalyzerInput,
  ctx: typeof NOOP_CTX,
) => Promise<CompetitorBrief>;

function getExecute(): Exec {
  // Dynamic import so mocks are in place when the module loads.
  return async (input, ctx) => {
    const { CompetitorAnalyzer } = await import('./index');
    const agent = new CompetitorAnalyzer();
    return (agent as unknown as { execute: Exec }).execute(input, ctx);
  };
}

const BASE_INPUT: CompetitorAnalyzerInput = {
  site_id: '00000000-0000-0000-0000-000000000001',
  niche: 'plumbing',
  city: 'Austin',
  state: 'TX',
  competitor_urls: [
    'https://plumber-austin.com/',
    'https://austin-plumbing-pros.com/',
  ],
};

// ---------- tests -------------------------------------------------------------

describe('competitor-analyzer: MOCK_AI path', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.MOCK_AI = 'true';
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    vi.clearAllMocks();
  });

  it('(a) brief matches CompetitorBrief Zod schema', async () => {
    const execute = getExecute();
    const brief = await execute(BASE_INPUT, NOOP_CTX);
    const result = CompetitorBrief.safeParse(brief);
    expect(result.success).toBe(true);
  });

  it('(a) brief has all required top-level fields', async () => {
    const execute = getExecute();
    const brief = await execute(BASE_INPUT, NOOP_CTX);
    expect(brief).toHaveProperty('analyzed_at');
    expect(brief).toHaveProperty('competitors');
    expect(brief).toHaveProperty('page_inventory');
    expect(brief).toHaveProperty('topic_coverage');
    expect(brief).toHaveProperty('entities');
    expect(brief).toHaveProperty('schema_types');
    expect(brief).toHaveProperty('content_gaps');
    expect(brief).toHaveProperty('structural_bar');
    expect(brief).toHaveProperty('keyword_opportunities');
  });

  it('(b) manual override competitor_urls pass through -- no aggregator filtering required', async () => {
    // top_local from DataForSEO is already aggregator-free. When using
    // competitor_urls override, all supplied URLs become entries regardless
    // of domain shape. The returned competitors should reflect the input.
    const execute = getExecute();
    const brief = await execute(BASE_INPUT, NOOP_CTX);
    // The mock Claude call returns one competitor in the tool output, but
    // execute() overwrites competitors with the resolved competitorEntries.
    expect(brief.competitors.length).toBeGreaterThan(0);
    // Verify shape of each competitor entry.
    for (const c of brief.competitors) {
      expect(typeof c.url).toBe('string');
      expect(typeof c.domain).toBe('string');
      expect(typeof c.serp_rank).toBe('number');
    }
  });

  it('(b) manual override with aggregator-looking domain still produces valid brief', async () => {
    // Even if caller passes an aggregator-like URL, the agent does not filter
    // it -- it is read-only research; filtering is the caller/SERP-layer concern.
    const execute = getExecute();
    const brief = await execute(
      { ...BASE_INPUT, competitor_urls: ['https://yelp.com/biz/plumber-austin'] },
      NOOP_CTX,
    );
    const result = CompetitorBrief.safeParse(brief);
    expect(result.success).toBe(true);
    expect(brief.competitors[0]?.domain).toBe('yelp.com');
  });

  it('(b) when no URLs resolve (empty dfsRaw, no override), returns empty brief with valid schema', async () => {
    const execute = getExecute();
    const brief = await execute(
      {
        site_id: '00000000-0000-0000-0000-000000000002',
        niche: 'plumbing',
        city: 'Austin',
        state: 'TX',
        // No competitor_urls, and the mock DB returns [] so dfsRaw is null.
      },
      NOOP_CTX,
    );
    const result = CompetitorBrief.safeParse(brief);
    expect(result.success).toBe(true);
    expect(brief.competitors).toHaveLength(0);
    expect(brief.keyword_opportunities).toHaveLength(0);
  });

  it('(c) returned brief has no field containing long scraped prose', async () => {
    const execute = getExecute();
    const brief = await execute(BASE_INPUT, NOOP_CTX);

    // Recursively collect all string values from the brief object.
    function collectStrings(obj: unknown): string[] {
      if (typeof obj === 'string') return [obj];
      if (Array.isArray(obj)) return obj.flatMap(collectStrings);
      if (obj !== null && typeof obj === 'object') {
        return Object.values(obj as Record<string, unknown>).flatMap(collectStrings);
      }
      return [];
    }

    const allStrings = collectStrings(brief);
    // No string field in the brief should be a long paragraph (>200 chars)
    // that could indicate scraped prose leaked through.
    for (const s of allStrings) {
      expect(s.length).toBeLessThan(200);
    }

    // Also assert the mock markdown text does not appear in any field.
    const mockPhrase = 'Services listed here.';
    for (const s of allStrings) {
      expect(s).not.toContain(mockPhrase);
    }
  });

  it('(c) brief has no unknown top-level keys beyond the typed fields', async () => {
    const execute = getExecute();
    const brief = await execute(BASE_INPUT, NOOP_CTX);
    const allowedKeys = new Set([
      'analyzed_at',
      'competitors',
      'page_inventory',
      'topic_coverage',
      'entities',
      'schema_types',
      'content_gaps',
      'structural_bar',
      'keyword_opportunities',
    ]);
    for (const key of Object.keys(brief)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
