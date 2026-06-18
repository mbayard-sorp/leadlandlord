import { describe, expect, it, vi } from 'vitest';
import { loadNicheOverlay, composeSystemPrompt, decorateSchemaWithClusterEnum, buildUserPrompt, ContentEngine } from './index';
import type { CompetitorBrief } from '../competitor-analyzer/schema';

// Stateful stub for the Anthropic client: the FIRST stream (initial generation)
// resolves with a Zod-valid but density-lint-failing bundle; the SECOND stream
// (density-lint retry) rejects to simulate a timeout. This exercises Fix 1's
// graceful-degradation path without a live API call.
const streamState = vi.hoisted(() => ({ calls: 0, bundle: null as unknown }));

vi.mock('@leadlandlord/integrations/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: () => {
        streamState.calls += 1;
        const isInitial = streamState.calls === 1;
        return {
          on: () => {},
          finalMessage: async () => {
            if (isInitial) {
              return {
                content: [
                  { type: 'tool_use', name: 'output_content_bundle', input: streamState.bundle },
                ],
                usage: { input_tokens: 10, output_tokens: 10 },
                stop_reason: 'tool_use',
              };
            }
            throw new Error('content-engine density-lint-retry stream timed out after 300s');
          },
        };
      },
    },
  }),
  estimateCostUsd: () => 0,
}));

describe('content-engine niche overlays', () => {
  it('loadNicheOverlay returns non-empty content with Terminology section for classic', () => {
    const overlay = loadNicheOverlay('classic');
    expect(overlay).not.toBeNull();
    expect(overlay!.length).toBeGreaterThan(500);
    expect(overlay!).toContain('Terminology');
  });

  it('all four theme keys map to non-empty overlays', () => {
    for (const theme of ['classic', 'modern', 'premium', 'bright']) {
      const overlay = loadNicheOverlay(theme);
      expect(overlay, `overlay for ${theme}`).not.toBeNull();
      expect(overlay!).toContain('Terminology');
      expect(overlay!).toContain('Seasonal Patterns');
      expect(overlay!).toContain('Regulations');
      expect(overlay!).toContain('Pain Points');
      expect(overlay!).toContain('Objections');
      expect(overlay!).toContain('Tone Notes');
    }
  });

  it('each theme overlay contains its own distinguishing heading', () => {
    expect(loadNicheOverlay('classic')!).toContain('Trade-Classic');
    expect(loadNicheOverlay('modern')!).toContain('Modern-Tech');
    expect(loadNicheOverlay('premium')!).toContain('Premium-Craft');
    expect(loadNicheOverlay('bright')!).toContain('Bright-Friendly');
  });

  it('unknown theme returns null', () => {
    expect(loadNicheOverlay('not-a-real-theme')).toBeNull();
    expect(loadNicheOverlay('')).toBeNull();
  });

  it('composeSystemPrompt with no theme returns base prompt only', () => {
    const base = composeSystemPrompt(undefined);
    expect(base.length).toBeGreaterThan(0);
    expect(base).not.toContain('Trade-Classic Overlay');
  });

  it('composeSystemPrompt with unknown theme falls back to base prompt', () => {
    const base = composeSystemPrompt(undefined);
    const unknown = composeSystemPrompt('nonsense');
    expect(unknown).toBe(base);
  });

  it('composeSystemPrompt with classic includes overlay separated by divider', () => {
    const composed = composeSystemPrompt('classic');
    expect(composed).toContain('\n\n---\n\n');
    expect(composed).toContain('Trade-Classic Overlay');
  });

  it('composeSystemPrompt produces different content per theme', () => {
    const classic = composeSystemPrompt('classic');
    const modern = composeSystemPrompt('modern');
    const premium = composeSystemPrompt('premium');
    const bright = composeSystemPrompt('bright');
    expect(new Set([classic, modern, premium, bright]).size).toBe(4);
  });
});

describe('decorateSchemaWithClusterEnum', () => {
  const slugs = ['cluster-a', 'cluster-b', 'cluster-c'];

  it('injects enum on cluster_key fields nested under page arrays', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        home: {
          type: 'object',
          properties: {
            cluster_key: { type: 'string' },
            slug: { type: 'string' },
          },
        },
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cluster_key: { type: 'string' },
              title: { type: 'string' },
            },
          },
        },
        blog_posts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cluster_key: { type: 'string' },
            },
          },
        },
      },
    };
    decorateSchemaWithClusterEnum(schema, slugs);
    const get = (path: string): Record<string, unknown> => {
      let cur: unknown = schema;
      for (const key of path.split('.')) cur = (cur as Record<string, unknown>)[key];
      return cur as Record<string, unknown>;
    };
    expect(get('properties.home.properties.cluster_key').enum).toEqual(slugs);
    expect(get('properties.services.items.properties.cluster_key').enum).toEqual(slugs);
    expect(get('properties.blog_posts.items.properties.cluster_key').enum).toEqual(slugs);
    // Sibling field untouched.
    expect(get('properties.home.properties.slug').enum).toBeUndefined();
  });

  it('is a no-op when cluster slug list is empty', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {
        home: {
          type: 'object',
          properties: { cluster_key: { type: 'string' } },
        },
      },
    };
    decorateSchemaWithClusterEnum(schema, []);
    const props = schema.properties as Record<string, { properties: Record<string, Record<string, unknown>> }>;
    expect(props.home!.properties.cluster_key!.enum).toBeUndefined();
  });

  it('leaves a schema without cluster_key fields unchanged', () => {
    const schema = {
      type: 'object',
      properties: {
        home: { type: 'object', properties: { title: { type: 'string' } } },
      },
    };
    const before = JSON.stringify(schema);
    decorateSchemaWithClusterEnum(schema, slugs);
    expect(JSON.stringify(schema)).toBe(before);
  });

  it('handles anyOf/oneOf branches', () => {
    const schema: Record<string, unknown> = {
      anyOf: [
        { type: 'object', properties: { cluster_key: { type: 'string' } } },
        { type: 'object', properties: { other: { type: 'string' } } },
      ],
    };
    decorateSchemaWithClusterEnum(schema, slugs);
    const branches = schema.anyOf as Array<{ properties: Record<string, Record<string, unknown>> }>;
    expect(branches[0]!.properties.cluster_key!.enum).toEqual(slugs);
  });
});

const basePools = {
  trustSignals: ['Licensed & insured', 'Free quotes'],
  headlineTemplate: '{service} in {city}',
};

const baseInput = {
  site_id: '00000000-0000-0000-0000-000000000001',
  niche: 'plumbing',
  city: 'Austin',
  state: 'TX',
  keyword_clusters: [],
  site_mode: 'thin' as const,
};

const sampleBrief: CompetitorBrief = {
  analyzed_at: '2026-01-01T00:00:00Z',
  competitors: [{ url: 'https://example.com', domain: 'example.com', serp_rank: 1 }],
  page_inventory: ['/services', '/contact'],
  topic_coverage: [
    { topic: 'drain cleaning', prevalence: 0.9 },
    { topic: 'water heater repair', prevalence: 0.5 },
  ],
  entities: ['Austin Water', 'Travis County'],
  schema_types: ['LocalBusiness', 'FAQPage'],
  content_gaps: ['emergency after-hours plumbing', 'slab leak detection'],
  structural_bar: { median_word_count: 1200, has_faq: true, has_pricing: true, has_reviews: false },
  keyword_opportunities: [
    { keyword: 'plumber austin tx', volume: 2400, ranked_by_competitors: 3 },
  ],
};

describe('buildUserPrompt competitor brief injection', () => {
  it('omits competitor section when no brief is passed', () => {
    const prompt = buildUserPrompt(baseInput, basePools);
    expect(prompt).not.toContain('COMPETITOR BRIEF - CLEAR');
  });

  it('includes competitor section when a brief is passed', () => {
    const prompt = buildUserPrompt({ ...baseInput, competitor_brief: sampleBrief }, basePools);
    expect(prompt).toContain('COMPETITOR BRIEF - CLEAR THE INCUMBENTS');
    expect(prompt).toContain('min_word_count=1200');
    expect(prompt).toContain('include FAQ section');
    expect(prompt).toContain('include pricing section');
    expect(prompt).not.toContain('include reviews section');
    expect(prompt).toContain('drain cleaning');
    expect(prompt).toContain('emergency after-hours plumbing');
    expect(prompt).toContain('plumber austin tx');
    expect(prompt).toContain('LocalBusiness');
    expect(prompt).toContain('/services');
  });

  it('does not expose the competitors provenance array in the prompt', () => {
    const prompt = buildUserPrompt({ ...baseInput, competitor_brief: sampleBrief }, basePools);
    expect(prompt).not.toContain('example.com');
    expect(prompt).not.toContain('serp_rank');
  });
});

describe('content-engine graceful degradation (Fix 1)', () => {
  function craftLintFailingBundle() {
    // home targets the 'home-c' cluster but its title/slug/meta/body omit the
    // primary keyword → density-lint flags keyword-in-h1 (error) on '/'.
    const page = (over: Record<string, unknown>) => ({
      kind: 'home',
      slug: '/',
      title: 'Welcome',
      meta_description: 'welcome',
      mdx: '## Hello\n\nSome generic content with no target phrase at all.',
      targeted_keywords: [],
      faqs: [],
      ...over,
    });
    return {
      niche: 'auto glass repair',
      city: 'Austin',
      state: 'TX',
      business_name: 'Austin Auto Glass Pros',
      variant: 'classic',
      home: page({ cluster_key: 'home-c', primary_keyword: 'auto glass repair' }),
      services: [],
      service_areas: [],
      about: page({ kind: 'about', slug: '/about', title: 'About', cluster_key: undefined, primary_keyword: undefined }),
      contact: page({ kind: 'contact', slug: '/contact', title: 'Contact', cluster_key: undefined, primary_keyword: undefined }),
      blog_posts: [],
      info_pages: [],
      faq_pages: [],
      neighborhoods: [],
      generated_at: '2026-01-01T00:00:00Z',
    };
  }

  const ctx = {
    runId: 'test-run',
    parentRunId: null,
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    recordUsage: () => {},
    progress: () => {},
    emitNextStepEvent: async () => {},
  };

  it('publishes the initial bundle (degraded) when the density-lint retry stream rejects', async () => {
    streamState.calls = 0;
    streamState.bundle = craftLintFailingBundle();

    const engine = new ContentEngine();
    const input = {
      site_id: '00000000-0000-0000-0000-000000000001',
      niche: 'auto glass repair',
      city: 'Austin',
      state: 'TX',
      keyword_clusters: [
        {
          cluster_key: 'home-c',
          page_kind: 'home',
          intent: 'commercial',
          primary_keyword: 'auto glass repair',
          supporting_keywords: [],
          search_volume: 100,
          total_volume: 100,
        },
      ],
      site_mode: 'thin',
    };

    // execute() is protected; call it directly to isolate the degradation logic
    // from BaseAgent's DB-backed run() wrapper.
    const result = await (engine as unknown as {
      execute: (i: unknown, c: unknown) => Promise<{ home: { title: string } }>;
    }).execute(input, ctx);

    // Both streams were consumed: initial succeeded, retry rejected.
    expect(streamState.calls).toBe(2);
    // No throw — the publishable initial bundle was returned.
    expect(result.home.title).toBe('Welcome');
    // Degradation marker recorded for site-builder to stamp on sites.metadata.
    const degradation = engine.consumeDensityDegradation();
    expect(degradation).not.toBeNull();
    expect(degradation!.residualSlugs).toContain('/');
    // consume() clears the marker.
    expect(engine.consumeDensityDegradation()).toBeNull();
  });
});

describe('content-engine theme passthrough (Fix 1.5)', () => {
  it('classic theme produces a system prompt that contains the trades overlay text', () => {
    const composed = composeSystemPrompt('classic');
    // The trades overlay (loaded for theme=classic) carries terminology not
    // present in the base system prompt — proving the overlay was actually
    // loaded into the system param. If site-builder ever drops `theme` again,
    // this string disappears from the system prompt.
    expect(composed).toContain('Trade-Classic Overlay');
    expect(composed.length).toBeGreaterThan(composeSystemPrompt(undefined).length);
  });
});
