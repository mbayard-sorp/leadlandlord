import { z } from 'zod';

export const SiteBuilderInput = z.object({
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  niche_id: z.string().uuid().optional(),
  site_id: z.string().uuid().optional(),
  fast_mode: z.boolean().optional(),
  /**
   * Re-target mode flag. When true, skip the keyword-planner sub-call (keep
   * existing Sanity clusters as-is) and let Content Engine regenerate against
   * them. Used by the operator's "Re-target content" button.
   */
  skip_keyword_planning: z.boolean().optional(),
});
export type SiteBuilderInput = z.infer<typeof SiteBuilderInput>;

export const SiteBuilderOutput = z.object({
  site_id: z.string().uuid(),
  /** Sanity site doc _id (always `site-${site_id}`). */
  sanity_site_doc_id: z.string(),
  /** Number of page docs written (home + about + contact + services + ...). */
  pages_written: z.number().int().nonnegative(),
  /** Active theme — operator can swap from the dashboard without re-running. */
  theme: z.enum(['classic', 'modern', 'premium', 'bright']),
  /** Hero image asset URL when generated, null when skipped (no API key) or failed. */
  hero_image_url: z.string().url().nullable(),
  tracking_number: z.string(),
  tracking_provider: z.enum(['twilio', 'mock']),
  deployed_at: z.string(),
});
export type SiteBuilderOutput = z.infer<typeof SiteBuilderOutput>;
