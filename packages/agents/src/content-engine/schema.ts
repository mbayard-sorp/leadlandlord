import { z } from 'zod';
import { ContentBundle } from '@leadlandlord/shared/types';

/**
 * One keyword cluster passed in from the Site Builder. Each cluster maps to
 * exactly one page. Content Engine must:
 *   - Pick exactly one page kind that matches `page_kind` to target this cluster
 *   - Use `primary_keyword` verbatim in that page's H1, slug, meta_description,
 *     and first 100 words of body
 *   - Distribute `supporting_keywords` across the body (1-3 occurrences each)
 *   - Declare the targeting in the page's `targeted_keywords` + `primary_keyword` fields
 */
export const KeywordClusterInput = z.object({
  cluster_key: z.string(),
  page_kind: z.enum(['home', 'service', 'service_area', 'blog', 'info']),
  intent: z.enum(['commercial', 'informational', 'local-modifier', 'navigational', 'transactional']),
  primary_keyword: z.string(),
  supporting_keywords: z.array(z.string()).default([]),
  search_volume: z.number().int().nonnegative().default(0),
  total_volume: z.number().int().nonnegative().default(0),
});
export type KeywordClusterInput = z.infer<typeof KeywordClusterInput>;

export const ContentEngineInput = z.object({
  site_id: z.string().uuid(),
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  business_name: z.string().optional(),
  /** When set, content engine generates fewer pages — useful for the dry-run. */
  fast_mode: z.boolean().optional(),
  /**
   * Theme variant for the site. Drives a niche-specific system-prompt overlay
   * (terminology, seasonality, tone) appended to the base prompt at runtime.
   * Optional — falls back to base prompt when omitted or unknown.
   */
  theme: z.enum(['classic', 'modern', 'premium', 'bright']).optional(),
  /**
   * Pre-planned keyword clusters from Keyword Planner. When non-empty,
   * Content Engine must target each cluster with exactly one page and
   * declare `targeted_keywords` + `primary_keyword` in the output.
   */
  keyword_clusters: z.array(KeywordClusterInput).default([]),
  /**
   * Controls page volume. 'thin' = 6-12 pages total (home + 4-6 services +
   * 3-5 FAQ blog posts, no service-area or info pages). 'content_rich' keeps
   * the existing ~28-page full-site output. Defaults to 'thin'.
   */
  site_mode: z.enum(['thin', 'content_rich']).default('thin'),
});
export type ContentEngineInput = z.infer<typeof ContentEngineInput>;

export const ContentEngineOutput = ContentBundle;
export type ContentEngineOutput = z.infer<typeof ContentEngineOutput>;
