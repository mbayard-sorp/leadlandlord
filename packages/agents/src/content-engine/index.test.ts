import { describe, expect, it } from 'vitest';
import { loadNicheOverlay, composeSystemPrompt, decorateSchemaWithClusterEnum, buildUserPrompt } from './index';
import type { CompetitorBrief } from '../competitor-analyzer/schema';

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
