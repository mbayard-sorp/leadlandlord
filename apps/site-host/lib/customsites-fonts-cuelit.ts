import { Fraunces, Inter } from 'next/font/google';

/**
 * Cuelit font registry (Custom Sites site #3). Own module per site, matching
 * lib/customsites-fonts.ts (site #1) and lib/customsites-fonts-aa.ts (#2).
 *
 * The Cuelit brand guide sets display type (display-xl, title, headline) in
 * Fraunces Bold and everything else in the system sans. Fraunces is on Google
 * Fonts, so it loads through next/font like every other face on this line.
 * One weight only: 700. Never below 20px, never on the prompter stage.
 *
 * Body text: SF Pro is not licensed for general web use, so cuelit.css puts
 * the system stack first. Apple hardware renders genuine SF Pro and fetches
 * nothing; Inter is the fallback everywhere else.
 *
 * Inter `preload: false`: with SF first in the stack, Apple devices never use
 * Inter, so a preload hint made every iPhone and Mac download it for nothing.
 * Fraunces is used above the fold on every page, so it keeps its preload.
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['700'],
  style: ['normal'],
  display: 'swap',
  variable: '--font-fraunces',
  adjustFontFallback: true,
});

export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal'],
  display: 'swap',
  preload: false,
  variable: '--font-inter',
  adjustFontFallback: true,
});

/** Combined className string for the `/cl` route wrapper. */
export const cuelitFontVars = `${fraunces.variable} ${inter.variable}`;
