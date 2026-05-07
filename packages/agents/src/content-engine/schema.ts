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
   * Pre-planned keyword clusters from Keyword Planner. When non-empty,
   * Content Engine must target each cluster with exactly one page and
   * declare `targeted_keywords` + `primary_keyword` in the output.
   */
  keyword_clusters: z.array(KeywordClusterInput).default([]),
});
export type ContentEngineInput = z.infer<typeof ContentEngineInput>;

export const ContentEngineOutput = ContentBundle;
export type ContentEngineOutput = z.infer<typeof ContentEngineOutput>;
