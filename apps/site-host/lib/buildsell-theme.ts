import { presetByName, BUILDSELL_PRESETS } from '@leadlandlord/sanity-schema/presets';
import type { BuildSellTheme } from './sanity';

/**
 * Resolved theme — every field a concrete value (or undefined) ready for CSS
 * custom properties. Colors are PRESET-DRIVEN: the palette comes entirely from
 * the doc's `preset` name matched against BUILDSELL_PRESETS, so changing the
 * preset in Studio recolors the site immediately. Fonts + layoutVariant stay
 * per-doc (the build rotates them independently of the palette); the preset
 * only supplies them as a fallback when the doc field is empty.
 *
 * The per-doc hex color fields were removed 2026-06-19. If a doc lacks a known
 * preset (e.g. a legacy name predating the 2026-06-19 spec reconciliation),
 * colors resolve to the DEFAULT preset (BUILDSELL_PRESETS[0]) so the site still
 * renders a complete premium palette — never colorless, never a crash.
 */
export interface ResolvedBuildSellTheme {
  layoutVariant: 'split' | 'bold' | 'trust';
  primary?: string;
  primaryDark?: string;
  accent?: string;
  onPrimary?: string;
  bg?: string;
  surface?: string;
  text?: string;
  muted?: string;
  fontHeading?: string;
  fontBody?: string;
}

export function resolveBuildSellTheme(theme: BuildSellTheme): ResolvedBuildSellTheme {
  // Unknown/legacy preset names fall back to the default preset so colors are
  // always a complete premium palette (see file header).
  const p = presetByName(theme.preset) ?? BUILDSELL_PRESETS[0]!;

  return {
    layoutVariant: (theme.layoutVariant ?? p?.layoutVariant ?? 'split') as 'split' | 'bold' | 'trust',
    // Colors: 100% preset-driven (per-doc hex fields removed 2026-06-19).
    primary: p?.primary,
    primaryDark: p?.primaryDark,
    accent: p?.accent,
    onPrimary: p?.onPrimary,
    bg: p?.bg,
    surface: p?.surface,
    text: p?.text,
    muted: p?.muted,
    // Fonts: keep the per-doc rotation; preset only fills a gap.
    fontHeading: theme.fontHeading ?? p?.fontHeading ?? undefined,
    fontBody: theme.fontBody ?? p?.fontBody ?? undefined,
  };
}
