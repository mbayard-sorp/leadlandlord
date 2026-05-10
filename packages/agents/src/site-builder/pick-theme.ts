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
export type ThemeKey = 'classic' | 'modern' | 'premium' | 'bright';

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
  'junk removal': 'bright',
  'move-out cleaning': 'bright',
  'move out cleaning': 'bright',
  'lawn care': 'bright',
  'dog walking': 'bright',
  'mobile auto detail': 'bright',
  'auto detail': 'bright',
  'holiday lights': 'bright',
  'pool cleaning': 'bright',
  'window cleaning': 'bright',
};

function normalizeNiche(niche: string): string {
  return niche.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a niche string to a theme key. Whitespace-tolerant, case-
 * insensitive, falls back to `'classic'` on no match. Never throws.
 */
export function pickThemeForNiche(niche: string): ThemeKey {
  if (!niche) return 'classic';
  const normalized = normalizeNiche(niche);
  return NICHE_THEME_MAP[normalized] ?? 'classic';
}
