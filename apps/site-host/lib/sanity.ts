import { createClient, type SanityClient } from 'next-sanity';
import imageUrlBuilder from '@sanity/image-url';
import type { SanityImageSource } from '@sanity/image-url/lib/types/types';

const projectId =
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID ?? 'ybdv5za2';
const dataset =
  process.env.NEXT_PUBLIC_SANITY_DATASET ?? process.env.SANITY_DATASET ?? 'production';

export const sanity: SanityClient = createClient({
  projectId,
  dataset,
  apiVersion: '2024-10-01',
  useCdn: true,
  perspective: 'published',
});

const imageBuilder = imageUrlBuilder(sanity);
export function urlForImage(source: SanityImageSource) {
  return imageBuilder.image(source);
}

/**
 * Site-doc projection: deref every page reference + theme so a single fetch
 * gives the whole render bundle. Slicing arrays at [0...50] guards against
 * pathological page counts blowing the GROQ projection size.
 */
const SITE_PROJECTION = `{
  _id, siteId, "slug": slug.current, businessName, niche, city, state,
  gaMeasurementId, robotsDisallow, generatedAt,
  trustSignals, nearbyCities,
  heroImagePrompt,
  "heroImageUrl": heroImage.asset->url,
  "theme": theme->name,
  domains[]{ host, isPrimary, verified, attachedAt },
  home->{ kind, slug, title, metaDescription, mdx, jsonLd },
  about->{ kind, slug, title, metaDescription, mdx, jsonLd },
  contact->{ kind, slug, title, metaDescription, mdx, jsonLd },
  "services": services[0...50]->{ kind, slug, title, metaDescription, mdx, jsonLd },
  "serviceAreas": serviceAreas[0...50]->{ kind, slug, title, metaDescription, mdx, jsonLd },
  "blogPosts": blogPosts[0...50]->{ kind, slug, title, metaDescription, mdx, jsonLd },
  "infoPages": infoPages[0...50]->{ kind, slug, title, metaDescription, mdx, jsonLd }
}`;

const SITE_BY_HOST_QUERY = `*[_type=="site" && $host in domains[].host][0]${SITE_PROJECTION}`;
const SITE_BY_SLUG_QUERY = `*[_type=="site" && slug.current==$slug][0]${SITE_PROJECTION}`;

export interface SanitySitePage {
  kind: string;
  slug: string;
  title: string;
  metaDescription: string;
  mdx: string;
  jsonLd?: string | null;
}

export interface SanitySite {
  _id: string;
  siteId: string;
  slug: string;
  businessName: string;
  niche: string;
  city: string;
  state: string;
  gaMeasurementId?: string | null;
  robotsDisallow?: boolean | null;
  generatedAt?: string | null;
  trustSignals?: string[] | null;
  nearbyCities?: string[] | null;
  heroImagePrompt?: string | null;
  heroImageUrl?: string | null;
  theme: 'classic' | 'modern' | 'premium' | 'bright';
  domains?: Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }> | null;
  home: SanitySitePage;
  about: SanitySitePage;
  contact: SanitySitePage;
  services?: SanitySitePage[] | null;
  serviceAreas?: SanitySitePage[] | null;
  blogPosts?: SanitySitePage[] | null;
  infoPages?: SanitySitePage[] | null;
}

/**
 * Look up a site by Host header. Phase B: per-request fetch against Sanity
 * CDN (useCdn: true). Edge ISR caching with cacheTag/cacheLife is Track C
 * — adding it requires cacheComponents + Suspense boundaries that aren't
 * worth the scaffolding overhead until perf becomes a real concern.
 */
export async function fetchSiteByHost(host: string): Promise<SanitySite | null> {
  const result = await sanity.fetch<SanitySite | null>(SITE_BY_HOST_QUERY, { host });
  return result ?? null;
}

/** Dev-fallback path: resolve by slug when host doesn't match (e.g. *.localhost or ?site=). */
export async function fetchSiteBySlug(slug: string): Promise<SanitySite | null> {
  const result = await sanity.fetch<SanitySite | null>(SITE_BY_SLUG_QUERY, { slug });
  return result ?? null;
}
