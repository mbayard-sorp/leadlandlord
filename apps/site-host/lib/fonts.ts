import {
  Oswald,
  Public_Sans,
  Bricolage_Grotesque,
  DM_Sans,
  DM_Serif_Display,
  Cormorant_Garamond,
  Source_Serif_4,
  Plus_Jakarta_Sans,
  Inter,
  Archivo_Black,
} from 'next/font/google';
import type { Variant } from './content';

/**
 * Per-variant font loadout from style-guides.html.
 *
 *   classic  : Oswald (display) + Public Sans (body)
 *   modern   : Bricolage Grotesque (display) + DM Sans (body)
 *   premium  : DM Serif Display + Cormorant Garamond (italic) + Source Serif 4 (body)
 *   bright   : Bricolage Grotesque (display) + Plus Jakarta Sans (body)
 *   haul     : Archivo Black (display) + Archivo (sub) + Inter (body)
 *   counsel  : Source Serif 4 (display) + Inter (body)
 *
 * Each font exposes a CSS variable. A site only renders one variant at a time
 * but we load all the variables on the root so themes/*.css can reference
 * --font-display / --font-body cleanly.
 */

export const oswald = Oswald({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-oswald',
  display: 'swap',
});

export const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-public-sans',
  display: 'swap',
});

export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-dm-serif',
  display: 'swap',
});

export const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
  display: 'swap',
});

export const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-source-serif',
  display: 'swap',
});

export const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

export const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

export const archivoBlack = Archivo_Black({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-archivo-black',
  display: 'swap',
});

const THEME_FONTS: Record<Variant, Array<{ variable: string }>> = {
  classic: [oswald, publicSans],
  modern:  [bricolage, dmSans],
  premium: [dmSerifDisplay, cormorant, sourceSerif],
  bright:  [bricolage, plusJakarta],
  haul:    [archivoBlack, inter],
  counsel: [sourceSerif, inter],
};

export function fontVarsForTheme(theme: Variant | null | undefined): string {
  const fonts = THEME_FONTS[theme ?? 'classic'] ?? THEME_FONTS.classic;
  return fonts.map((f) => f.variable).join(' ');
}
