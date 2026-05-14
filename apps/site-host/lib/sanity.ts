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
const PAGE_PROJECTION = `{ kind, slug, title, metaDescription, mdx, jsonLd, "pageOgImageUrl": pageOgImage.asset->url }`;

const SITE_PROJECTION = `{
  _id, siteId, "slug": slug.current, businessName, niche, city, state, siteMode,
  gaMeasurementId, robotsDisallow, generatedAt,
  trustSignals, nearbyCities,
  heroImagePrompt,
  "heroImageUrl": heroImage.asset->url,
  "theme": theme->name,
  domains[]{ host, isPrimary, verified, attachedAt },
  home->${PAGE_PROJECTION},
  about->${PAGE_PROJECTION},
  contact->${PAGE_PROJECTION},
  "services": services[0...50]->${PAGE_PROJECTION},
  "serviceAreas": serviceAreas[0...50]->${PAGE_PROJECTION},
  "blogPosts": blogPosts[0...50]->${PAGE_PROJECTION},
  "infoPages": infoPages[0...50]->${PAGE_PROJECTION},
  "reviews": reviews[0...100]->{ author, rating, text, source, "date": date, verified },
  aggregateRating{ ratingValue, reviewCount, bestRating },
  licenseNumber, insuranceCarrier, yearsInBusiness, responseTimePromise,
  certifications[]{ name, issuer, year },
  "photoGallery": photoGallery[]{ "url": image.asset->url, alt, caption },
  guarantees
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
  pageOgImageUrl?: string | null;
}

export interface SanitySite {
  _id: string;
  siteId: string;
  slug: string;
  businessName: string;
  niche: string;
  city: string;
  state: string;
  siteMode?: 'thin' | 'content_rich' | null;
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
  // Trust-signal fields (all optional — ADR 0001)
  reviews?: Array<{
    author: string;
    rating: number;
    text: string;
    source: 'google' | 'yelp' | 'bbb' | 'facebook' | 'direct';
    date: string;
    verified: boolean;
  }> | null;
  aggregateRating?: {
    ratingValue: number;
    reviewCount: number;
    bestRating?: number | null;
  } | null;
  licenseNumber?: string | null;
  insuranceCarrier?: string | null;
  yearsInBusiness?: number | null;
  responseTimePromise?: string | null;
  certifications?: Array<{
    name: string;
    issuer?: string | null;
    year?: number | null;
  }> | null;
  photoGallery?: Array<{
    url: string;
    alt: string;
    caption?: string | null;
  }> | null;
  guarantees?: string[] | null;
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

// --- corporate (leadslandlord.com) -----------------------------------------

export interface CorporatePage {
  kind: string;
  slug?: string | null;
  title: string;
  metaDescription?: string | null;
  heroEyebrow?: string | null;
  heroHeadline?: string | null;
  heroSubhead?: string | null;
  mdx?: string | null;
  jsonLd?: string | null;
}

export interface CorporateSite {
  _id: string;
  brandName: string;
  tagline?: string | null;
  primaryHost?: string | null;
  legalEntity?: {
    name?: string | null;
    dba?: string | null;
    address?: string | null;
    supportEmail?: string | null;
    legalEmail?: string | null;
  } | null;
  navItems?: Array<{ label: string; href: string }> | null;
  footerLinks?: Array<{ label: string; href: string }> | null;
  primaryCta?: { label?: string | null; href?: string | null } | null;
  smsDisclosure?: string | null;
  gaMeasurementId?: string | null;
  robotsDisallow?: boolean | null;
}

const CORPORATE_SITE_QUERY = `*[_type=="corporateSite"][0]{
  _id, brandName, tagline, primaryHost,
  legalEntity, navItems, footerLinks, primaryCta,
  smsDisclosure, gaMeasurementId, robotsDisallow
}`;

const CORPORATE_PAGE_QUERY = `*[_type=="corporatePage" && kind==$kind][0]{
  kind, slug, title, metaDescription,
  heroEyebrow, heroHeadline, heroSubhead, mdx, jsonLd
}`;

export async function fetchCorporateSite(): Promise<CorporateSite | null> {
  const result = await sanity.fetch<CorporateSite | null>(CORPORATE_SITE_QUERY, {});
  return result ?? null;
}

export async function fetchCorporatePage(kind: string): Promise<CorporatePage | null> {
  const result = await sanity.fetch<CorporatePage | null>(CORPORATE_PAGE_QUERY, { kind });
  return result ?? null;
}
