import { presetByName } from '@leadlandlord/sanity-schema/presets';
import type { BuildSellTheme } from './sanity';

/**
 * Resolved theme — every field a concrete value (or undefined) ready for CSS
 * custom properties. Colors are PRESET-AUTHORITATIVE: when the doc's `preset`
 * name matches BUILDSELL_PRESETS, the palette comes from the table, so changing
 * the preset in Studio recolors the site immediately. Fonts + layoutVariant
 * stay per-doc (the build rotates them independently of the palette); the
 * preset only supplies them as a fallback when the doc field is empty.
 *
 * Legacy/safety path: when `preset` isn't in the table (docs predating it), all
 * colors fall back to the doc's own stored hex — so a pre-existing site renders
 * exactly as before, never silently recolored on deploy.
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
  // Colors: preset wins when the name is known; else the doc's stored hex.
  const color = (presetVal: string | undefined, stored?: string | null): string | undefined =>
    p ? presetVal : (stored ?? undefined);

  return {
    layoutVariant: (theme.layoutVariant ?? p?.layoutVariant ?? 'split') as 'split' | 'bold' | 'trust',
    primary: color(p?.primary, theme.primary),
    primaryDark: color(p?.primaryDark, theme.primaryDark),
    accent: color(p?.accent, theme.accent),
    onPrimary: color(p?.onPrimary, theme.onPrimary),
    bg: color(p?.bg, theme.bg),
    surface: color(p?.surface, theme.surface),
    text: color(p?.text, theme.text),
    muted: color(p?.muted, theme.muted),
    // Fonts: keep the per-doc rotation; preset only fills a gap.
    fontHeading: theme.fontHeading ?? p?.fontHeading ?? undefined,
    fontBody: theme.fontBody ?? p?.fontBody ?? undefined,
  };
}
