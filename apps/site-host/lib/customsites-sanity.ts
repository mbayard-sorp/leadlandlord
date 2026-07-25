import { sanity } from './sanity';

/**
 * Sanity fetch layer for Custom Sites (`cs*` doc types, ADR 0033). Kept
 * separate from lib/sanity.ts so that file doesn't keep growing with a third
 * business line's projections — R&R (`site`), Corporate (`corporateSite`),
 * and Build & Sell (`buildsellSite`) all live there; Custom Sites lives here.
 *
 * No Postgres coupling (ADR 0033 D4) — `csSite` in Sanity is the entire
 * source of truth, resolved by `siteKey` or by `customDomain` (host).
 */

export interface CustomSiteAddress {
  street?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface CustomSiteNavChildLink {
  label?: string | null;
  href?: string | null;
}

export interface CustomSiteNavLink {
  label?: string | null;
  href?: string | null;
  children?: CustomSiteNavChildLink[] | null;
}

export interface CustomSiteRedirect {
  from?: string | null;
  to?: string | null;
}

export interface CustomSiteSeo {
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
}

export interface CustomSiteGeo {
  lat?: number | null;
  lng?: number | null;
}

export interface CustomSite {
  _id: string;
  siteKey: string;
  name: string;
  customDomain?: string | null;
  tagline?: string | null;
  phone?: string | null;
  cellPhone?: string | null;
  email?: string | null;
  address?: CustomSiteAddress | null;
  mapUrl?: string | null;
  mapEmbedUrl?: string | null;
  geo?: CustomSiteGeo | null;
  logoUrl?: string | null;
  footerLogoUrl?: string | null;
  bannerImageUrl?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  navigation?: CustomSiteNavLink[] | null;
  footerNav?: CustomSiteNavLink[] | null;
  leadRecipients?: string[] | null;
  gtmContainerId?: string | null;
  sameAs?: string[] | null;
  organizationType?: string | null;
  openingHours?: string[] | null;
  robotsDisallow?: boolean | null;
  redirects?: CustomSiteRedirect[] | null;
  seo?: CustomSiteSeo | null;
}

const CUSTOM_SITE_PROJECTION = `{
  _id, siteKey, name, customDomain, tagline, phone, cellPhone, email,
  address{ street, unit, city, state, zip },
  mapUrl, mapEmbedUrl,
  geo{ lat, lng },
  "logoUrl": logo.asset->url,
  "footerLogoUrl": footerLogo.asset->url,
  "bannerImageUrl": bannerImage.asset->url,
  "faviconUrl": favicon.asset->url,
  "ogImageUrl": ogImage.asset->url,
  navigation[]{ label, href, children[]{ label, href } },
  footerNav[]{ label, href, children[]{ label, href } },
  leadRecipients, gtmContainerId, sameAs, organizationType, openingHours,
  robotsDisallow,
  redirects[]{ from, to },
  seo{ metaTitle, metaDescription, "ogImageUrl": ogImage.asset->url }
}`;

const CUSTOM_SITE_BY_KEY_QUERY = `*[_type=="csSite" && siteKey==$siteKey][0]${CUSTOM_SITE_PROJECTION}`;
const CUSTOM_SITE_BY_HOST_QUERY = `*[_type=="csSite" && customDomain==$host][0]${CUSTOM_SITE_PROJECTION}`;

export async function fetchCustomSiteByKey(siteKey: string): Promise<CustomSite | null> {
  const result = await sanity.fetch<CustomSite | null>(CUSTOM_SITE_BY_KEY_QUERY, { siteKey });
  return result ?? null;
}

/**
 * Strip port and a leading "www." so both the apex and www resolve to the
 * same bare-apex value stored in csSite.customDomain. Mirrors
 * fetchBuildSellSiteByHost's host normalization in lib/sanity.ts.
 */
export function normalizeCustomHost(host: string): string {
  return host.split(':')[0]!.toLowerCase().replace(/^www\./, '');
}

export async function fetchCustomSiteByHost(host: string): Promise<CustomSite | null> {
  const bare = normalizeCustomHost(host);
  const result = await sanity.fetch<CustomSite | null>(CUSTOM_SITE_BY_HOST_QUERY, { host: bare });
  return result ?? null;
}

// --- Content stubs for sitemap / llms.txt / llms-full.txt / md -------------
// Minimal projections — just enough for the crawl-surface routes in this
// phase. Phase 3's page rendering will likely want richer projections
// (pageBuilder / body) added alongside these, not instead of them.

export interface CustomSitePageStub {
  slug: string;
  title: string;
  modifiedAt?: string | null;
  publishedAt?: string | null;
}

export interface CustomSitePracticeAreaStub {
  slug: string;
  title: string;
  excerpt?: string | null;
  modifiedAt?: string | null;
  publishedAt?: string | null;
}

export interface CustomSitePublicationStub {
  slug: string;
  title: string;
  excerpt?: string | null;
  modifiedAt?: string | null;
  publishedAt?: string | null;
}

const CS_PAGE_LIST_QUERY = `*[_type=="csPage" && site->siteKey==$siteKey && defined(slug.current)]{
  "slug": slug.current, title, modifiedAt, publishedAt
}`;

const CS_PRACTICE_AREA_LIST_QUERY = `*[_type=="csPracticeArea" && site->siteKey==$siteKey && defined(slug.current)]{
  "slug": slug.current, title, excerpt, modifiedAt, publishedAt, order
} | order(order asc)`;

const CS_PUBLICATION_LIST_QUERY = `*[_type=="csPublication" && site->siteKey==$siteKey && defined(slug.current)]{
  "slug": slug.current, title, excerpt, modifiedAt, publishedAt
} | order(publishedAt desc)`;

export async function fetchCustomSitePages(siteKey: string): Promise<CustomSitePageStub[]> {
  const result = await sanity.fetch<CustomSitePageStub[] | null>(CS_PAGE_LIST_QUERY, { siteKey });
  return result ?? [];
}

export async function fetchCustomSitePracticeAreas(siteKey: string): Promise<CustomSitePracticeAreaStub[]> {
  const result = await sanity.fetch<CustomSitePracticeAreaStub[] | null>(CS_PRACTICE_AREA_LIST_QUERY, { siteKey });
  return result ?? [];
}

export async function fetchCustomSitePublications(siteKey: string): Promise<CustomSitePublicationStub[]> {
  const result = await sanity.fetch<CustomSitePublicationStub[] | null>(CS_PUBLICATION_LIST_QUERY, { siteKey });
  return result ?? [];
}

// --- Phase 3: full projections for page rendering ---------------------------
// Additive to the stubs above (kept for sitemap/llms.txt/md), not a
// replacement — those routes only need slug/title/excerpt/dates.

export interface CsPortableTextBlock {
  _type: string;
  _key: string;
  /** Present on image members (asset deref'd to url/dims below). */
  url?: string;
  dims?: { width?: number; height?: number } | null;
  alt?: string | null;
  caption?: string | null;
  [key: string]: unknown;
}

/** Portable Text array member projection — spreads all block fields, and
 * deref's `asset` on image members to a plain url + dimensions. */
const CS_BODY_MEMBER_PROJECTION = `{
  ...,
  _type == "image" => {
    "url": asset->url,
    "dims": asset->metadata.dimensions
  }
}`;

const CS_BODY_PROJECTION = `[]${CS_BODY_MEMBER_PROJECTION}`;

export interface CsFaqItem {
  question: string;
  answer: string;
}

export interface CustomSiteAttorney {
  _id: string;
  name: string;
  slug: string;
  jobTitle?: string | null;
  photoUrl?: string | null;
  photoAlt?: string | null;
  bio?: CsPortableTextBlock[] | null;
  bioSections?: Array<{ heading?: string | null; content?: CsPortableTextBlock[] | null }> | null;
  credentials?: string[] | null;
  sameAs?: string[] | null;
  email?: string | null;
  phone?: string | null;
  vCardUrl?: string | null;
}

const CS_ATTORNEY_PROJECTION = `{
  _id, name, "slug": slug.current, jobTitle,
  "photoUrl": photo.asset->url,
  "photoAlt": photo.alt,
  bio${CS_BODY_PROJECTION},
  bioSections[]{ heading, content${CS_BODY_PROJECTION} },
  credentials, sameAs, email, phone,
  "vCardUrl": vCard.asset->url
}`;

export interface CustomSitePracticeAreaCard {
  _id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  order?: number | null;
  cardImageUrl?: string | null;
  cardImageAlt?: string | null;
}

// `order` is projected because the sort runs after the projection: without it
// `| order(order asc)` has no field to sort on and falls back to id order.
const CS_PRACTICE_AREA_CARD_PROJECTION = `{
  _id, title, "slug": slug.current, excerpt, order,
  "cardImageUrl": cardImage.asset->url,
  "cardImageAlt": cardImage.alt
}`;

export interface CustomSitePracticeAreaFull {
  _id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  heroImageUrl?: string | null;
  heroImageAlt?: string | null;
  cardImageUrl?: string | null;
  body?: CsPortableTextBlock[] | null;
  faqs?: CsFaqItem[] | null;
  order?: number | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  seo?: CustomSiteSeo | null;
}

const CS_PRACTICE_AREA_FULL_PROJECTION = `{
  _id, title, "slug": slug.current, excerpt,
  "heroImageUrl": heroImage.asset->url,
  "heroImageAlt": heroImage.alt,
  "cardImageUrl": cardImage.asset->url,
  body${CS_BODY_PROJECTION},
  faqs[]{ question, answer },
  order, publishedAt, modifiedAt,
  seo{ metaTitle, metaDescription, "ogImageUrl": ogImage.asset->url }
}`;

export interface CustomSitePublicationFull {
  _id: string;
  title: string;
  slug: string;
  kind: 'article' | 'publication' | 'presentation';
  excerpt?: string | null;
  body?: CsPortableTextBlock[] | null;
  publishedAt: string;
  modifiedAt?: string | null;
  externalEvent?: string | null;
  externalDate?: string | null;
  coAuthors?: string | null;
  pdfUrl?: string | null;
  featuredImageUrl?: string | null;
  featuredImageAlt?: string | null;
  authorName?: string | null;
  authorSlug?: string | null;
  seo?: CustomSiteSeo | null;
}

const CS_PUBLICATION_FULL_PROJECTION = `{
  _id, title, "slug": slug.current, kind, excerpt,
  body${CS_BODY_PROJECTION},
  publishedAt, modifiedAt, externalEvent, externalDate, coAuthors,
  "pdfUrl": pdf.asset->url,
  "featuredImageUrl": featuredImage.asset->url,
  "featuredImageAlt": featuredImage.alt,
  "authorName": author->name,
  "authorSlug": author->slug.current,
  seo{ metaTitle, metaDescription, "ogImageUrl": ogImage.asset->url }
}`;

/** One member of csPage.pageBuilder, conditionally projected by `_type` so the
 * shared field names across block types (e.g. `heading`, `body`) never bleed
 * into the wrong block shape. */
const CS_PAGE_BUILDER_PROJECTION = `pageBuilder[]{
  _type,
  _key,
  _type == "csHeroBlock" => {
    eyebrow, heading, subheading, ctaLabel, ctaHref,
    "backgroundImageUrl": backgroundImage.asset->url,
    "backgroundImageAlt": backgroundImage.alt
  },
  _type == "csIntroBlock" => {
    eyebrow, heading,
    body${CS_BODY_PROJECTION},
    ctaLabel, ctaHref, layout, bodyDividers, topRule
  },
  _type == "csPracticeGridBlock" => {
    eyebrow, heading, mode,
    "areas": areas[]->${CS_PRACTICE_AREA_CARD_PROJECTION}
  },
  _type == "csAttorneyBlock" => {
    showFullProfile,
    "attorney": attorney->${CS_ATTORNEY_PROJECTION}
  },
  _type == "csTestimonialsBlock" => {
    "items": items[]->{ _id, quote, author, role },
    autoRotate
  },
  _type == "csBadgeRowBlock" => {
    "badges": badges[]->{ _id, name, "imageUrl": image.asset->url, "imageAlt": image.alt, url }
  },
  _type == "csPublicationsBlock" => {
    eyebrow, heading, limit, ctaLabel, ctaHref
  },
  _type == "csCalloutBlock" => {
    label, quote, linkLabel, linkHref
  },
  _type == "csRichTextBlock" => {
    content${CS_BODY_PROJECTION}
  },
  _type == "csContactCtaBlock" => {
    eyebrow, heading, body, showForm
  },
  _type == "csCtaBannerBlock" => {
    heading, ctaLabel, ctaHref
  }
}`;

export interface CsHeroBlock { _type: 'csHeroBlock'; _key: string; eyebrow?: string | null; heading: string; subheading?: string | null; ctaLabel?: string | null; ctaHref?: string | null; backgroundImageUrl?: string | null; backgroundImageAlt?: string | null }
export interface CsIntroBlock { _type: 'csIntroBlock'; _key: string; eyebrow?: string | null; heading?: string | null; body?: CsPortableTextBlock[] | null; ctaLabel?: string | null; ctaHref?: string | null; layout?: 'split' | 'stacked' | null; bodyDividers?: boolean | null; topRule?: boolean | null }
export interface CsPracticeGridBlock { _type: 'csPracticeGridBlock'; _key: string; eyebrow?: string | null; heading?: string | null; mode?: 'all' | 'selected' | null; areas?: CustomSitePracticeAreaCard[] | null }
export interface CsAttorneyBlock { _type: 'csAttorneyBlock'; _key: string; showFullProfile?: boolean | null; attorney?: CustomSiteAttorney | null }
export interface CsTestimonialItem { _id: string; quote: string; author?: string | null; role?: string | null }
export interface CsTestimonialsBlock { _type: 'csTestimonialsBlock'; _key: string; items?: CsTestimonialItem[] | null; autoRotate?: boolean | null }
export interface CsBadgeItem { _id: string; name: string; imageUrl?: string | null; imageAlt?: string | null; url?: string | null }
export interface CsBadgeRowBlock { _type: 'csBadgeRowBlock'; _key: string; badges?: CsBadgeItem[] | null }
export interface CsPublicationsBlock { _type: 'csPublicationsBlock'; _key: string; eyebrow?: string | null; heading?: string | null; limit?: number | null; ctaLabel?: string | null; ctaHref?: string | null }
export interface CsCalloutBlock { _type: 'csCalloutBlock'; _key: string; label?: string | null; quote?: string | null; linkLabel?: string | null; linkHref?: string | null }
export interface CsRichTextBlock { _type: 'csRichTextBlock'; _key: string; content?: CsPortableTextBlock[] | null }
export interface CsContactCtaBlock { _type: 'csContactCtaBlock'; _key: string; eyebrow?: string | null; heading?: string | null; body?: string | null; showForm?: boolean | null }
export interface CsCtaBannerBlock { _type: 'csCtaBannerBlock'; _key: string; heading?: string | null; ctaLabel?: string | null; ctaHref?: string | null }

export type CsPageBuilderBlock =
  | CsHeroBlock
  | CsIntroBlock
  | CsPracticeGridBlock
  | CsAttorneyBlock
  | CsTestimonialsBlock
  | CsBadgeRowBlock
  | CsPublicationsBlock
  | CsCalloutBlock
  | CsRichTextBlock
  | CsContactCtaBlock
  | CsCtaBannerBlock;

export interface CustomSitePageFull {
  _id: string;
  title: string;
  slug: string;
  bannerImageUrl?: string | null;
  bannerImageAlt?: string | null;
  pageBuilder?: CsPageBuilderBlock[] | null;
  seo?: CustomSiteSeo | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
}

const CS_PAGE_FULL_PROJECTION = `{
  _id, title, "slug": slug.current,
  "bannerImageUrl": bannerImage.asset->url,
  "bannerImageAlt": bannerImage.alt,
  ${CS_PAGE_BUILDER_PROJECTION},
  seo{ metaTitle, metaDescription, "ogImageUrl": ogImage.asset->url },
  publishedAt, modifiedAt
}`;

export async function fetchCustomSitePageBySlug(siteKey: string, slug: string): Promise<CustomSitePageFull | null> {
  const query = `*[_type=="csPage" && site->siteKey==$siteKey && slug.current==$slug][0]${CS_PAGE_FULL_PROJECTION}`;
  const result = await sanity.fetch<CustomSitePageFull | null>(query, { siteKey, slug });
  return result ?? null;
}

export async function fetchCustomSitePracticeAreaCards(siteKey: string): Promise<CustomSitePracticeAreaCard[]> {
  const query = `*[_type=="csPracticeArea" && site->siteKey==$siteKey && defined(slug.current)]${CS_PRACTICE_AREA_CARD_PROJECTION} | order(order asc)`;
  const result = await sanity.fetch<CustomSitePracticeAreaCard[] | null>(query, { siteKey });
  return result ?? [];
}

/** Standalone testimonial list, for pages that show quotes outside a pageBuilder. */
export async function fetchCustomSiteTestimonials(siteKey: string): Promise<CsTestimonialItem[]> {
  const query = `*[_type=="csTestimonial" && site->siteKey==$siteKey]{_id, quote, author, role} | order(order asc)`;
  const result = await sanity.fetch<CsTestimonialItem[] | null>(query, { siteKey });
  return result ?? [];
}

export async function fetchCustomSitePracticeAreaFull(
  siteKey: string,
  slug: string,
): Promise<CustomSitePracticeAreaFull | null> {
  const query = `*[_type=="csPracticeArea" && site->siteKey==$siteKey && slug.current==$slug][0]${CS_PRACTICE_AREA_FULL_PROJECTION}`;
  const result = await sanity.fetch<CustomSitePracticeAreaFull | null>(query, { siteKey, slug });
  return result ?? null;
}

export async function fetchCustomSitePublicationsFull(siteKey: string): Promise<CustomSitePublicationFull[]> {
  const query = `*[_type=="csPublication" && site->siteKey==$siteKey && defined(slug.current)]${CS_PUBLICATION_FULL_PROJECTION} | order(publishedAt desc)`;
  const result = await sanity.fetch<CustomSitePublicationFull[] | null>(query, { siteKey });
  return result ?? [];
}

export interface CustomSiteAttorneySummary {
  _id: string;
  name: string;
  slug: string;
  jobTitle?: string | null;
  sameAs?: string[] | null;
}

const CS_ATTORNEY_LIST_QUERY = `*[_type=="csAttorney" && site->siteKey==$siteKey] | order(_createdAt asc){
  _id, name, "slug": slug.current, jobTitle, sameAs
}`;

/** Attorney summaries for a site, oldest-first (stable "primary attorney"
 * ordering for the layout's Person JSON-LD node when a site has exactly one). */
export async function fetchCustomSiteAttorneys(siteKey: string): Promise<CustomSiteAttorneySummary[]> {
  const result = await sanity.fetch<CustomSiteAttorneySummary[] | null>(CS_ATTORNEY_LIST_QUERY, { siteKey });
  return result ?? [];
}

export async function fetchCustomSitePublicationFull(
  siteKey: string,
  slug: string,
): Promise<CustomSitePublicationFull | null> {
  const query = `*[_type=="csPublication" && site->siteKey==$siteKey && slug.current==$slug][0]${CS_PUBLICATION_FULL_PROJECTION}`;
  const result = await sanity.fetch<CustomSitePublicationFull | null>(query, { siteKey, slug });
  return result ?? null;
}

export interface CustomSiteRouteBundle {
  page: CustomSitePageFull | null;
  pub: CustomSitePublicationFull | null;
  redirectTo: string | null;
}

/**
 * Single GROQ round trip for app/cadr/[slug]/page.tsx: resolves whichever of
 * csPage / csPublication / csSite.redirects[].from matches the slug. Callers
 * check `page`, then `pub`, then `redirectTo`, in that order (mirrors the
 * route's disambiguation logic).
 */
export async function fetchCustomSiteRouteBundle(siteKey: string, slug: string): Promise<CustomSiteRouteBundle> {
  const query = `{
    "page": *[_type=="csPage" && site->siteKey==$siteKey && slug.current==$slug][0]${CS_PAGE_FULL_PROJECTION},
    "pub": *[_type=="csPublication" && site->siteKey==$siteKey && slug.current==$slug][0]${CS_PUBLICATION_FULL_PROJECTION},
    "redirectTo": *[_type=="csSite" && siteKey==$siteKey][0].redirects[from==$slug][0].to
  }`;
  const result = await sanity.fetch<CustomSiteRouteBundle>(query, { siteKey, slug });
  return result ?? { page: null, pub: null, redirectTo: null };
}
