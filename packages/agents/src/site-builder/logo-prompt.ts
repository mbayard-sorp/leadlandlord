/**
 * Shared logo prompt helper — used by both the backfill script
 * (scripts/backfill-logos.ts) and the site-builder logo step (index.ts).
 *
 * Produces a TEXT-FREE symbolic flat icon/emblem prompt for Imagen.
 * The motif is seeded from the niche family; the color hint and container
 * shape are selected via a deterministic string-hash of businessName so no
 * two sites collapse to the same generated image.
 *
 * CRITICAL: all selections are pure and deterministic — no random(), no
 * Date(), no crypto.randomUUID(). Re-running with the same inputs always
 * produces the same prompt strings.
 */

export interface LogoPromptInput {
  niche: string;
  businessName: string;
  city: string;
  /** Optional colorPalette from the site row. Currently unused but accepted
   *  for forward compatibility — callers may pass it without effect. */
  colorPalette?: string;
}

export interface LogoPromptResult {
  /** The positive prompt to pass to generateHeroImageBuffer. */
  prompt: string;
  /** The negativePrompt to pass to generateHeroImageBuffer. */
  negativePrompt: string;
}

// ---------------------------------------------------------------------------
// Niche -> family mapping (local to this package — avoids coupling
// packages/* to apps/site-host for the NICHE_SUBTYPES map).
// ---------------------------------------------------------------------------

type NicheFamily =
  | 'roofing'
  | 'plumbing'
  | 'hvac'
  | 'tree'
  | 'electrical'
  | 'painting'
  | 'cleaning'
  | 'landscaping'
  | 'pest'
  | 'locksmith'
  | 'moving'
  | 'default';

/**
 * Resolve a free-form niche string to a canonical family for motif selection.
 * Word-boundary match so "roof" catches "roof replacement" / "roofing" but
 * not "basement waterproofing".
 */
function nicheFamily(niche: string): NicheFamily {
  const key = niche.toLowerCase().trim();
  const checks: Array<[RegExp, NicheFamily]> = [
    [/\broof/, 'roofing'],
    [/\bplumb|\bplumber/, 'plumbing'],
    [/\bhvac|\bair.?condition|\bheating|\bcooling/, 'hvac'],
    [/\btree|\barborist/, 'tree'],
    [/\belectric/, 'electrical'],
    [/\bpaint|\bpainter/, 'painting'],
    [/\bclean|\bmaid/, 'cleaning'],
    [/\blandscap|\bgarden|\blawn/, 'landscaping'],
    [/\bpest/, 'pest'],
    [/\blocksmith|\block.?&.?key/, 'locksmith'],
    [/\bmoving|\bjunk.?removal|\bmovers/, 'moving'],
  ];
  for (const [re, family] of checks) {
    if (re.test(key)) return family;
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// Motifs per family
// ---------------------------------------------------------------------------

const FAMILY_MOTIFS: Record<NicheFamily, string> = {
  roofing: 'a minimalist gable rooftop silhouette with clean geometric lines',
  plumbing: 'a minimalist pipe-and-droplet symbol with curved lines',
  hvac: 'a minimalist snowflake-and-flame dual icon representing cooling and heating airflow',
  tree: 'a minimalist leaf canopy silhouette with branching lines',
  electrical: 'a minimalist lightning bolt symbol with sharp angles',
  painting: 'a minimalist paint roller icon with a clean brushstroke arc',
  cleaning: 'a minimalist three-sparkle burst symbol',
  landscaping: 'a minimalist leaf-and-shrub silhouette with layered foliage',
  pest: 'a minimalist shield with a crossed-circle pest symbol',
  locksmith: 'a minimalist key-and-padlock icon',
  moving: 'a minimalist cardboard box with an arrow symbol',
  default: 'a minimalist house outline inside a shield shape',
};

// ---------------------------------------------------------------------------
// Color palettes for the logo
// ---------------------------------------------------------------------------

const COLOR_PALETTES = [
  'deep navy blue and white',
  'forest green and cream',
  'warm terracotta and off-white',
  'slate gray and gold',
  'midnight blue and silver',
  'dark teal and white',
  'burgundy and beige',
  'charcoal and sky blue',
] as const;

// ---------------------------------------------------------------------------
// Container shapes
// ---------------------------------------------------------------------------

const CONTAINER_SHAPES = [
  'inside a circular badge shape',
  'inside a rounded square badge shape',
  'inside a shield emblem shape',
] as const;

// ---------------------------------------------------------------------------
// Deterministic string hash — djb2 variant, pure, no external dependencies
// ---------------------------------------------------------------------------

/**
 * Returns a stable non-negative 32-bit integer hash of `s`.
 * Same inputs always produce the same output; no randomness or side effects.
 */
function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // h = ((h << 5) + h) ^ charCode  (djb2-xor)
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return h;
}

function pickByHash<T extends readonly unknown[]>(arr: T, seed: string): T[number] {
  return arr[stringHash(seed) % arr.length];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an Imagen prompt for a logo mark.
 *
 * The returned `prompt` requests a TEXT-FREE flat symbolic icon/emblem;
 * `negativePrompt` explicitly excludes text, letters, faces, and photography.
 *
 * Motif: niche family (deterministic from `niche`).
 * Color: deterministic hash of `businessName`.
 * Container: deterministic hash of `businessName + city`.
 */
export function logoPrompt(input: LogoPromptInput): LogoPromptResult {
  const { niche, businessName, city } = input;

  const family = nicheFamily(niche);
  const motif = FAMILY_MOTIFS[family];

  const colorHint = pickByHash(COLOR_PALETTES, businessName) as string;
  const container = pickByHash(CONTAINER_SHAPES, businessName + city) as string;

  const prompt = [
    `A flat vector logo mark: ${motif} ${container}.`,
    `Color scheme: ${colorHint}.`,
    'Clean minimalist icon, solid flat shapes, no gradient, no shadow.',
    'NO text, NO letters, NO words, NO monogram, NO initials, NO typography.',
    'Isolated on a pure white background.',
    'Professional business emblem style.',
  ].join(' ');

  const negativePrompt =
    'text, letters, words, typography, monogram, initials, watermark, photograph, realistic photo, people, faces, hands, complex illustration, 3D render, noise, texture, gradient, drop shadow';

  return { prompt, negativePrompt };
}
