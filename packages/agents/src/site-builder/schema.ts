import { z } from 'zod';

/**
 * Preprocess step: coerce a stray camelCase `nicheId` into the canonical
 * `niche_id` so a mis-cased payload from an older caller doesn't silently
 * drop the niche linkage. The canonical `niche_id` always wins when both are
 * present. All other fields are passed through unchanged.
 */
function normalizeNicheId(val: unknown): unknown {
  if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if (obj.nicheId !== undefined && obj.niche_id === undefined) {
      return { ...obj, niche_id: obj.nicheId };
    }
  }
  return val;
}

export const SiteBuilderInput = z.preprocess(
  normalizeNicheId,
  z.object({
    niche: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    /**
     * Canonical snake_case field. Populated by niche approval event payloads.
     * The preprocess above also accepts a stray camelCase `nicheId` so
     * mis-cased legacy payloads still resolve the linkage rather than
     * silently dropping it.
     */
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
    /**
     * Long-form-only mode. When true, skip the entire build pipeline and only
     * (re)generate the keyword-rich home intro, patching just `longformBody` /
     * `longformGeneratedAt` on the existing Sanity site doc. Requires `site_id`.
     * Drives the operator's "Generate long-form intro" backfill button.
     */
    longform_only: z.boolean().optional(),
  }),
);
export type SiteBuilderInput = z.infer<typeof SiteBuilderInput>;

export const SiteBuilderOutput = z.object({
  site_id: z.string().uuid(),
  /** Sanity site doc _id (always `site-${site_id}`). */
  sanity_site_doc_id: z.string(),
  /** Number of page docs written (home + about + contact + services + ...). */
  pages_written: z.number().int().nonnegative(),
  /** Active theme — operator can swap from the dashboard without re-running. */
  theme: z.enum(['classic', 'modern', 'premium', 'bright', 'haul', 'counsel']),
  /** Color palette within the theme — operator can swap without re-running. */
  color_palette: z.enum(['default', 'alt1', 'alt2']),
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
