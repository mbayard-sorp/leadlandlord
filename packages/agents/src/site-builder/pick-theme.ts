/**
 * Maps a niche string to one of the four LeadLandlord visual variants.
 *
 * The mapping mirrors the variant table in
 * `packages/agents/src/content-engine/system.md` (the "Variant selection"
 * section). Site-builder calls this BEFORE invoking content-engine so the
 * niche overlay (`niches/<theme>.md`) is loaded into the system prompt at
 * generation time. Without this, content-engine receives `theme: undefined`
 * and the trades / modern / premium / bright overlay markdown is never read
 * — the variant choice the model makes downstream is then ungrounded.
 *
 * Matching is case-insensitive and whitespace-tolerant. Unknown niches fall
 * back to `'classic'` (the catch-all general home-services bucket per
 * system.md). Add a niche to `NICHE_THEME_MAP` to give it a non-default
 * variant.
 */
export type ThemeKey = 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';

/**
 * Static niche → theme assignments. Keys are normalized (lowercased,
 * collapsed whitespace) before lookup. Mirror system.md:41-46.
 */
export const NICHE_THEME_MAP: Record<string, ThemeKey> = {
  // classic — traditional trades
  'hvac': 'classic',
  'plumbing': 'classic',
  'electrical': 'classic',
  'gutter cleaning': 'classic',
  'roofing': 'classic',
  'fence install': 'classic',
  'septic': 'classic',
  'tree work': 'classic',
  'tree service': 'classic',
  'garage door': 'classic',
  'drain cleaning': 'classic',
  'water heater repair': 'classic',
  'pest control': 'classic',
  'foundation repair': 'classic',

  // modern — install-led, tech-forward
  'solar install': 'modern',
  'solar': 'modern',
  'ev charging install': 'modern',
  'ev charging': 'modern',
  'smart-home install': 'modern',
  'smart home install': 'modern',
  'water-heater install': 'modern',
  'water heater install': 'modern',
  'tankless water heater install': 'modern',
  'heat pump install': 'modern',
  'home automation': 'modern',
  'security system install': 'modern',
  'ev pre-wiring': 'modern',
  'ev prewiring': 'modern',

  // premium — bespoke / craft
  'custom landscape design': 'premium',
  'custom landscape': 'premium',
  'kitchen remodel': 'premium',
  'bath remodel': 'premium',
  'bathroom remodel': 'premium',
  'custom pools': 'premium',
  'custom pool': 'premium',
  'fine carpentry': 'premium',
  'custom closets': 'premium',
  'theater install': 'premium',
  'home theater install': 'premium',
  'cellar conversion': 'premium',
  'wine cellar': 'premium',
  'hardscape': 'premium',
  'hardscape & stone': 'premium',
  'hardscape and stone': 'premium',

  // bright — recurring / friendly
  'house cleaning': 'bright',
  'move-out cleaning': 'bright',
  'move out cleaning': 'bright',
  'lawn care': 'bright',
  'dog walking': 'bright',
  'mobile auto detail': 'bright',
  'auto detail': 'bright',
  'holiday lights': 'bright',
  'pool cleaning': 'bright',
  'window cleaning': 'bright',

  // haul — blue-collar hauling / removal / demo
  'junk removal': 'haul',
  'junk hauling': 'haul',
  'hauling': 'haul',
  'dumpster rental': 'haul',
  'demolition': 'haul',
  'demo': 'haul',
  'debris removal': 'haul',
  'estate cleanout': 'haul',
  'property cleanout': 'haul',
  'appliance removal': 'haul',
  'furniture removal': 'haul',
  'moving help': 'haul',

  // counsel — small-town legal lead-gen
  'family law': 'counsel',
  'divorce': 'counsel',
  'divorce attorney': 'counsel',
  'personal injury': 'counsel',
  'personal injury attorney': 'counsel',
  'bankruptcy': 'counsel',
  'bankruptcy attorney': 'counsel',
  'estate planning': 'counsel',
  'dui': 'counsel',
  'dui attorney': 'counsel',
  'criminal defense': 'counsel',
  'family law attorney': 'counsel',
  'custody': 'counsel',
  'wills and trusts': 'counsel',
};

/**
 * Category → theme fallback, applied only when the specific niche string
 * isn't in `NICHE_THEME_MAP`. Catches legal niches whose exact wording the
 * niche map doesn't enumerate (e.g. "medical malpractice lawyer") so the
 * content engine still loads the counsel overlay — which carries
 * NON-NEGOTIABLE legal-advertising constraints (ADR 0002, ADR 0012), not just
 * styling. Keyed by the niches-table `category` value (see ServiceCategory).
 * Medical has no dedicated variant yet, so it falls through to classic.
 */
export const CATEGORY_THEME_MAP: Record<string, ThemeKey> = {
  legal: 'counsel',
};

function normalizeNiche(niche: string): string {
  return niche.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a niche to a theme key. The specific niche string wins; if it's
 * unknown, fall back to the niche's category (e.g. legal → counsel); if that's
 * also unknown, fall back to `'classic'`. Whitespace-tolerant, case-
 * insensitive. Never throws.
 *
 * `category` is the niches-table `category` column (nullable text). Pass it so
 * legal sites get counsel content even when the niche wording isn't in
 * `NICHE_THEME_MAP` — a theme swap after the fact only re-skins CSS, it does
 * not regenerate the (compliance-sensitive) copy.
 */
export function pickTheme(niche: string, category?: string | null): ThemeKey {
  const normalized = niche ? normalizeNiche(niche) : '';
  const byNiche = normalized ? NICHE_THEME_MAP[normalized] : undefined;
  if (byNiche) return byNiche;
  if (category) {
    const byCategory = CATEGORY_THEME_MAP[category.trim().toLowerCase()];
    if (byCategory) return byCategory;
  }
  return 'classic';
}

/** Back-compat wrapper: niche-only resolution with no category fallback. */
export function pickThemeForNiche(niche: string): ThemeKey {
  return pickTheme(niche);
}
