import { z } from 'zod';

export const CompetitorAnalyzerInput = z.object({
  site_id: z.string().uuid(),
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  /** Looked up against niches table when competitor_urls is absent. */
  niche_id: z.string().uuid().optional(),
  /** Manual override: skip SERP lookup and scrape these URLs directly. */
  competitor_urls: z.array(z.string().url()).optional(),
});
export type CompetitorAnalyzerInput = z.infer<typeof CompetitorAnalyzerInput>;

export const CompetitorBrief = z.object({
  analyzed_at: z.string(),
  competitors: z.array(
    z.object({
      url: z.string(),
      domain: z.string(),
      serp_rank: z.number().int(),
    }),
  ),
  /** Distinct page path patterns observed across scraped competitor sites. */
  page_inventory: z.array(z.string()),
  /** Topics and how many competitors cover each (prevalence = fraction 0..1). */
  topic_coverage: z.array(
    z.object({
      topic: z.string(),
      prevalence: z.number().min(0).max(1),
    }),
  ),
  /** Named entities (brands, certifications, locations, services) found across competitors. */
  entities: z.array(z.string()),
  /** schema.org types in use across competitor pages (e.g. "LocalBusiness", "FAQPage"). */
  schema_types: z.array(z.string()),
  /** Topics competitors cover thinly or omit entirely -- our differentiation targets. */
  content_gaps: z.array(z.string()),
  structural_bar: z.object({
    median_word_count: z.number().int(),
    has_faq: z.boolean(),
    has_pricing: z.boolean(),
    has_reviews: z.boolean(),
  }),
  keyword_opportunities: z.array(
    z.object({
      keyword: z.string(),
      volume: z.number().int(),
      ranked_by_competitors: z.number().int(),
    }),
  ),
});
export type CompetitorBrief = z.infer<typeof CompetitorBrief>;
