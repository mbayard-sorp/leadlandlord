import { Spectral, Public_Sans } from 'next/font/google';

/**
 * Custom Sites font registry (ADR 0033, Phase 3). Scoped to the `/cadr`
 * namespace only — never applied on tenant/corporate/B&S hosts. Mirrors
 * lib/buildsell-fonts.ts's shape (own registry per business line rather than
 * growing lib/fonts.ts, which is tenant-variant specific).
 *
 * Display: Spectral (serif), weights 400/600/700 + italic 400.
 * Body: Public Sans, weights 400/500/600/700.
 */

export const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--cs-font-display',
  display: 'swap',
});

export const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--cs-font-body',
  display: 'swap',
});

/** Combined className string for the `/cadr` route wrapper. */
export const customSiteFontVars = `${spectral.variable} ${publicSans.variable}`;
