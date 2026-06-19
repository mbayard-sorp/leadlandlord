import { presetByName } from '@leadlandlord/sanity-schema/presets';
import type { BuildSellTheme } from './sanity';

/**
 * Resolved theme — every field a concrete value (or undefined) ready for CSS
 * custom properties. Colors are PRESET-DRIVEN: the palette comes entirely from
 * the doc's `preset` name matched against BUILDSELL_PRESETS, so changing the
 * preset in Studio recolors the site immediately. Fonts + layoutVariant stay
 * per-doc (the build rotates them independently of the palette); the preset
 * only supplies them as a fallback when the doc field is empty.
 *
 * The per-doc hex color fields were removed 2026-06-19. If a doc somehow lacks
 * a known preset, colors resolve to undefined and the CSS custom-property
 * fallbacks in buildsell.css apply — never a crash.
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
  const p = presetByName(theme.preset);

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
