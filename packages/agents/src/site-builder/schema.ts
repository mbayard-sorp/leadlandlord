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
  /**
   * Force a fresh content generation, bumping the site's build_epoch so the
   * cached content-engine run is bypassed. Set by the operator's "Re-target
   * content" / "Regenerate" actions. A plain reaper retry leaves this unset so
   * it reuses the cached run and finishes the unfinished tail in seconds.
   */
  force_content_refresh: z.boolean().optional(),
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
  /**
   * Tracking number is provisioned out of band (operator does it manually via
   * the site detail page), so site-builder no longer sets it — null until an
   * operator assigns one.
   */
  tracking_number: z.string().nullable(),
  tracking_provider: z.enum(['twilio', 'mock']).nullable(),
  deployed_at: z.string(),
});
export type SiteBuilderOutput = z.infer<typeof SiteBuilderOutput>;
