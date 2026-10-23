import { Inter } from 'next/font/google';

/**
 * CueDuo font registry (Custom Sites site #3). Own module per site, matching
 * lib/customsites-fonts.ts (site #1) and lib/customsites-fonts-aa.ts (#2).
 *
 * The brand guide specifies SF Pro and nothing else. SF Pro is not on Google
 * Fonts and is not licensed for general web use, and this line loads fonts
 * through next/font/google only, so cueduo.css puts the system stack first:
 * Apple hardware renders genuine SF Pro and fetches nothing at all. Inter is
 * the fallback everywhere else, and it is the only family downloaded.
 *
 * Two weights, matching the guide: 600 names or asks, 400 explains. No
 * italics, no 300, no 700.
 *
 * `preload: false`: with SF first in the stack, Apple devices never use
 * Inter, so a preload hint made every iPhone and Mac download it for nothing.
 * Without it the browser fetches Inter only where it actually falls back.
 */
export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal'],
  display: 'swap',
  preload: false,
  variable: '--font-inter',
  adjustFontFallback: true,
});

/** Combined className string for the `/cd` route wrapper. */
export const cueDuoFontVars = inter.variable;
