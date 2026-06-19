/**
 * presets.ts
 *
 * Build & Sell color/layout/font presets — the SINGLE SOURCE OF TRUTH for
 * spec-site theming. Kept deliberately free of any `sanity` import so it can be
 * consumed by site-host (render) and packages/agents (build) without pulling
 * the Studio bundle. `theme.ts` re-imports this for the Studio dropdown list.
 *
 * The named `preset` on a buildsellSite doc is authoritative for COLORS at
 * render time (see apps/site-host/lib/buildsell-theme.ts) — the per-doc hex
 * fields are only a fallback for legacy docs whose preset name predates this
 * table. Fonts + layoutVariant stay independent per-doc fields (the build
 * rotates them separately from the palette to reduce footprint similarity).
 *
 * CANONICAL: this table mirrors the claude.ai/design "Pool Spec Site" Style
 * Guide (12 palettes, §7) exactly — names + hex. It was reconciled to the design
 * on 2026-06-19 (all live sites were draft at the time, so the rename was safe).
 * Going forward this is APPEND-ONLY: never rename or recolor an existing entry —
 * live sites store the preset NAME, and renaming/recoloring would silently
 * restyle every site that already picked it. Add new presets at the end instead.
 * Unknown names resolve to the default preset (see buildsell-theme.ts), so a
 * legacy doc never renders colorless.
 */

export interface BuildsellPreset {
  name: string;
  layoutVariant: 'split' | 'bold' | 'trust';
  primary: string;
  primaryDark: string;
  accent: string;
  onPrimary: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  fontHeading: string;
  fontBody: string;
}

/**
 * 12 named presets — the claude.ai/design "Pool Spec Site" Style Guide palettes,
 * exact names + hex (§7). All ship the spec's premium type pair (Space Grotesk
 * headings / Plus Jakarta Sans body). `layoutVariant` is a balanced default
 * rotation (4 split / 4 bold / 4 trust) — buyers can still switch it per-doc.
 * The last three are dark palettes with a NON-white `onPrimary` (their primaries
 * are light amber/teal/lime, so on-primary text must be dark for AA contrast).
 */
const FH = 'Space Grotesk';
const FB = 'Plus Jakarta Sans';
export const BUILDSELL_PRESETS: BuildsellPreset[] = [
  { name: 'Aqua Slate', layoutVariant: 'split', primary: '#0d9488', primaryDark: '#0f766e', accent: '#f59e0b', onPrimary: '#ffffff', bg: '#f4f7f8', surface: '#ffffff', text: '#0f1f24', muted: '#5b6b72', fontHeading: FH, fontBody: FB },
  { name: 'Deep Marine', layoutVariant: 'bold', primary: '#2563eb', primaryDark: '#1e40af', accent: '#f97316', onPrimary: '#ffffff', bg: '#f5f7fb', surface: '#ffffff', text: '#0f1729', muted: '#5a6782', fontHeading: FH, fontBody: FB },
  { name: 'Forest Pro', layoutVariant: 'trust', primary: '#15803d', primaryDark: '#14532d', accent: '#d97706', onPrimary: '#ffffff', bg: '#f5f8f4', surface: '#ffffff', text: '#14241a', muted: '#5c6b5e', fontHeading: FH, fontBody: FB },
  { name: 'Crimson Trust', layoutVariant: 'trust', primary: '#dc2626', primaryDark: '#991b1b', accent: '#0ea5e9', onPrimary: '#ffffff', bg: '#f9f6f6', surface: '#ffffff', text: '#261617', muted: '#6e5a5b', fontHeading: FH, fontBody: FB },
  { name: 'Pacific Cyan', layoutVariant: 'split', primary: '#0891b2', primaryDark: '#0e7490', accent: '#f43f5e', onPrimary: '#ffffff', bg: '#f3f9fb', surface: '#ffffff', text: '#0c1f26', muted: '#57707a', fontHeading: FH, fontBody: FB },
  { name: 'Sunset Clay', layoutVariant: 'bold', primary: '#ea580c', primaryDark: '#c2410c', accent: '#0d9488', onPrimary: '#ffffff', bg: '#fbf7f4', surface: '#ffffff', text: '#2a1c14', muted: '#7a6354', fontHeading: FH, fontBody: FB },
  { name: 'Royal Plum', layoutVariant: 'bold', primary: '#7c3aed', primaryDark: '#5b21b6', accent: '#f59e0b', onPrimary: '#ffffff', bg: '#f8f6fc', surface: '#ffffff', text: '#1f1630', muted: '#6b5f7e', fontHeading: FH, fontBody: FB },
  { name: 'Olive Stone', layoutVariant: 'split', primary: '#4d7c0f', primaryDark: '#3f6212', accent: '#ca8a04', onPrimary: '#ffffff', bg: '#f8f8f3', surface: '#ffffff', text: '#1f2410', muted: '#6b7155', fontHeading: FH, fontBody: FB },
  { name: 'Sky & Sand', layoutVariant: 'trust', primary: '#0284c7', primaryDark: '#0369a1', accent: '#f59e0b', onPrimary: '#ffffff', bg: '#f8f6f0', surface: '#ffffff', text: '#14222e', muted: '#5d6f7c', fontHeading: FH, fontBody: FB },
  { name: 'Midnight Gold', layoutVariant: 'bold', primary: '#f59e0b', primaryDark: '#d97706', accent: '#38bdf8', onPrimary: '#1a1206', bg: '#0b1220', surface: '#131c2e', text: '#eef2f8', muted: '#90a0b8', fontHeading: FH, fontBody: FB },
  { name: 'Charcoal Teal', layoutVariant: 'trust', primary: '#2dd4bf', primaryDark: '#14b8a6', accent: '#fbbf24', onPrimary: '#06231f', bg: '#0f1418', surface: '#1a2228', text: '#e7eef0', muted: '#8ba0a5', fontHeading: FH, fontBody: FB },
  { name: 'Graphite Lime', layoutVariant: 'split', primary: '#84cc16', primaryDark: '#65a30d', accent: '#22d3ee', onPrimary: '#16210a', bg: '#14171a', surface: '#1e2329', text: '#e8ede6', muted: '#93a08f', fontHeading: FH, fontBody: FB },
];

/** Preset names in declaration order — used by the build rotation + Studio dropdown. */
export const BUILDSELL_PRESET_NAMES: string[] = BUILDSELL_PRESETS.map((p) => p.name);

/**
 * Look up a preset by its stored name. Returns null when the name isn't in the
 * table (legacy docs predating a given preset) — callers fall back to the
 * doc's own stored hex fields so a pre-existing site renders unchanged.
 */
export function presetByName(name?: string | null): BuildsellPreset | null {
  if (!name) return null;
  return BUILDSELL_PRESETS.find((p) => p.name === name) ?? null;
}
