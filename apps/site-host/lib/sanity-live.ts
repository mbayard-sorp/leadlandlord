/**
 * Sanity Live API — preview subtree only.
 *
 * `sanityFetch` and `SanityLive` are mounted exclusively in the
 * /preview/[id] route subtree (via app/preview/[id]/layout.tsx).
 * The public /buildsell/[slug] route uses the plain `sanity` client
 * from lib/sanity.ts and MUST NOT import from this module.
 */
import { defineLive } from 'next-sanity/live';
import { sanityStega } from './sanity';

export const { sanityFetch, SanityLive } = defineLive({
  client: sanityStega.withConfig({ apiVersion: '2024-10-01' }),
  serverToken: process.env.SANITY_API_READ_TOKEN,
  browserToken: process.env.SANITY_API_READ_TOKEN,
});
