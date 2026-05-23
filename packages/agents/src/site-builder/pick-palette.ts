/**
 * Maps a site to one of three color palettes within its base theme.
 *
 * Sites in the same niche all resolve to the same base theme (see
 * `pick-theme.ts`), so without variation they would share an accent color —
 * an observable network footprint. Spreading sites across three palettes per
 * theme breaks that signal.
 *
 * The choice is a stable hash of `site_id` mod 3, so:
 *   - rebuilds of the same site are idempotent (no churn, respects dedupe);
 *   - the palette is uncorrelated with niche or theme (footprint-safe).
 *
 * Operators can override the palette in Sanity afterward; persist-sanity does
 * not clobber an operator-set value on rebuild.
 */
export type PaletteKey = 'default' | 'alt1' | 'alt2';

const PALETTES: readonly PaletteKey[] = ['default', 'alt1', 'alt2'];

/** FNV-1a 32-bit hash — small, dependency-free, well-distributed. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Resolve a site id to a palette key. Deterministic and stable across calls.
 * Falls back to 'default' for empty input.
 */
export function pickPaletteForSite(siteId: string): PaletteKey {
  if (!siteId) return 'default';
  return PALETTES[hashString(siteId) % PALETTES.length]!;
}
