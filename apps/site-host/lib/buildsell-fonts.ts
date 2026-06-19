/**
 * Build & Sell font registry.
 *
 * Each preset declares a heading font and a body font. All fonts are loaded
 * with display:'swap' and expose a CSS variable. The variables are applied on
 * the buildsell route wrapper so `var(--bs-font-heading)` / `var(--bs-font-body)`
 * resolve to an actually-loaded font family, not system-ui.
 *
 * themeVars() in BuildSellHome maps the Sanity `theme.fontHeading` / `theme.fontBody`
 * preset strings to the loaded CSS-variable names via BUILDSELL_FONT_VAR_MAP.
 */

import {
  Space_Grotesk,
  Plus_Jakarta_Sans,
  Poppins,
  Sora,
  Manrope,
  Inter,
  Fraunces,
} from 'next/font/google';

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-space-grotesk',
  display: 'swap',
});

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-plus-jakarta',
  display: 'swap',
});

export const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-poppins',
  display: 'swap',
});

export const sora = Sora({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-sora',
  display: 'swap',
});

export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-fraunces',
  display: 'swap',
});

export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bs-manrope',
  display: 'swap',
});

export const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-bs-inter',
  display: 'swap',
});

/** All B&S font objects — spread their `.variable` onto the wrapper element. */
export const ALL_BS_FONTS = [
  spaceGrotesk,
  plusJakartaSans,
  poppins,
  sora,
  fraunces,
  manrope,
  inter,
];

/**
 * Maps the Sanity `theme.fontHeading` / `theme.fontBody` string values that
 * the builder writes to the CSS variable name that owns that font-family.
 *
 * The CSS variable is then used as the VALUE of `--bs-font-heading` /
 * `--bs-font-body` so that the property resolves to a real loaded family.
 *
 * e.g. fontHeading='Space Grotesk'
 *   → --bs-font-heading: var(--font-bs-space-grotesk)
 */
export const BUILDSELL_FONT_VAR_MAP: Record<string, string> = {
  'Space Grotesk':    'var(--font-bs-space-grotesk)',
  'Plus Jakarta Sans':'var(--font-bs-plus-jakarta)',
  'Poppins':          'var(--font-bs-poppins)',
  'Sora':             'var(--font-bs-sora)',
  'Fraunces':         'var(--font-bs-fraunces)',
  'Manrope':          'var(--font-bs-manrope)',
  'Inter':            'var(--font-bs-inter)',
};

/**
 * Returns the CSS font-family reference for a given preset font name string.
 * Falls back to `system-ui, sans-serif` when the name is unknown so the page
 * still renders with a legible fallback.
 */
export function resolveBsFont(fontName: string | null | undefined): string {
  if (!fontName) return 'system-ui, sans-serif';
  return BUILDSELL_FONT_VAR_MAP[fontName] ?? `'${fontName}', system-ui, sans-serif`;
}
