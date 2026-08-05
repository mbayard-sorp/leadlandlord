import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

/**
 * Aligned Advisors font registry (Custom Sites site #2). A sibling of
 * customsites-fonts.ts (site #1's Spectral/Public Sans) rather than an
 * extension of it, so the /cadr bundle never pulls AA's font subsets and
 * vice versa. Scoped to the `/aa` namespace only.
 *
 * aa.css consumes these exact variable names:
 *   --font-archivo    → display (Archivo, grotesque)
 *   --font-plex-sans  → body (IBM Plex Sans)
 *   --font-plex-mono  → labels/eyebrows/figures (IBM Plex Mono, tabular)
 */

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

export const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

/** Combined className string for the `/aa` route wrapper. */
export const alignedAdvisorsFontVars = `${archivo.variable} ${plexSans.variable} ${plexMono.variable}`;
