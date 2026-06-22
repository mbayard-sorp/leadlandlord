import { createClient, stegaClean, type SanityClient } from 'next-sanity';
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

/**
 * Stega-enabled client used only by the /preview/[id] subtree.
 * The `stegaClean` applied in stegaCleanStructural() strips stega watermarks
 * from structural/routing fields while leaving display text encoded for
 * Presentation overlays. Do NOT use this client on the public /buildsell/[slug]
 * route — that path must stay fast with the plain `sanity` client above.
 */
export const sanityStega: SanityClient = createClient({
  projectId,
  dataset,
  apiVersion: '2024-10-01',
  useCdn: false, // draft perspective requires API, not CDN
  perspective: 'previewDrafts',
  stega: {
    enabled: true,
    studioUrl: process.env.NEXT_PUBLIC_SANITY_STUDIO_URL ?? '/studio',
  },
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
const PAGE_PROJECTION = `{ _id, kind, slug, title, metaDescription, mdx, jsonLd, faqs[]{ q, a }, "pageOgImageUrl": pageOgImage.asset->url, "articleImageUrl": articleImage.asset->url, "dateModified": dateModified }`;

const SITE_PROJECTION = `{
  _id, siteId, "slug": slug.current, businessName, niche, city, state, siteMode,
  gaMeasurementId, robotsDisallow, indexnowKey, generatedAt,
  latitude, longitude, sameAs,
  trustSignals, nearbyCities,
  "neighborhoods": neighborhoods[]{ name, "googleMapsUrl": googleMapsUrl },
  heroImagePrompt,
  "heroImageUrl": heroImage.asset->url,
  videoUrl, videoDescription, longformBody,
  "logoUrl": logo.asset->url,
  "faviconUrl": favicon.asset->url,
  "theme": theme->name,
  colorPalette,
  domains[]{ host, isPrimary, verified, attachedAt },
  home->${PAGE_PROJECTION},
  about->${PAGE_PROJECTION},
  contact->${PAGE_PROJECTION},
  "services": services[0...50]->${PAGE_PROJECTION},
  "serviceAreas": serviceAreas[0...50]->${PAGE_PROJECTION},
  "blogPosts": blogPosts[0...50]->${PAGE_PROJECTION},
  "infoPages": infoPages[0...50]->${PAGE_PROJECTION},
  "faqPages": faqPages[0...50]->${PAGE_PROJECTION},
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
  /** Sanity doc id, e.g. `page-${siteId}-service-${index}`. Matches crossSiteLinks.sourcePageId. */
  _id: string;
  kind: string;
  slug: string;
  title: string;
  metaDescription: string;
  mdx: string;
  jsonLd?: string | null;
  faqs?: Array<{ q: string; a: string }> | null;
  pageOgImageUrl?: string | null;
  articleImageUrl?: string | null;
  /** ISO timestamp surfaced as Article `dateModified`. Phase 2 populates it. */
  dateModified?: string | null;
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
  indexnowKey?: string | null;
  generatedAt?: string | null;
  /** Geo + sameAs for LocalBusiness structured data. Phase 2 populates these. */
  latitude?: number | null;
  longitude?: number | null;
  sameAs?: string[] | null;
  trustSignals?: string[] | null;
  nearbyCities?: string[] | null;
  neighborhoods?: Array<{ name: string; googleMapsUrl: string }> | null;
  heroImagePrompt?: string | null;
  heroImageUrl?: string | null;
  videoUrl?: string | null;
  videoDescription?: string | null;
  longformBody?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  theme: 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';
  colorPalette?: 'default' | 'alt1' | 'alt2' | null;
  domains?: Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }> | null;
  home: SanitySitePage;
  about: SanitySitePage;
  contact: SanitySitePage;
  services?: SanitySitePage[] | null;
  serviceAreas?: SanitySitePage[] | null;
  blogPosts?: SanitySitePage[] | null;
  infoPages?: SanitySitePage[] | null;
  faqPages?: SanitySitePage[] | null;
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

export interface CorporatePageStub {
  kind: string;
  updatedAt: string;
}

// Only published corporatePage docs (perspective: 'published'). The sitemap
// must not advertise a kind whose Sanity doc is missing/draft — the route
// notFound()s and Google records a soft 404.
const CORPORATE_PAGE_LIST_QUERY = `*[_type=="corporatePage" && defined(kind)]{
  kind, "updatedAt": _updatedAt
}`;

export async function fetchCorporatePageList(): Promise<CorporatePageStub[]> {
  const result = await sanity.fetch<CorporatePageStub[] | null>(CORPORATE_PAGE_LIST_QUERY, {});
  return result ?? [];
}

// --- Build & Sell (B&S) spec sites ----------------------------------------

/**
 * Full GROQ projection for a buildsellSite doc. Colors are unpacked from the
 * Sanity @sanity/color-input `color` object to plain hex strings. Review refs
 * inside bsReviewsSection are dereffed inline.
 */
const BUILDSELL_PROJECTION = `{
  _id,
  buildsellSiteId,
  businessName,
  trade,
  city,
  state,
  phone,
  placeId,
  "slug": slug.current,
  draftMode,
  themeLocked,
  robotsDisallow,
  generatedAt,
  navigation[]{ label, href },
  navShowPhone,
  navCta{ label, href, style },
  "theme": {
    "layoutVariant": theme.layoutVariant,
    "preset": theme.preset,
    "fontHeading": theme.fontHeading,
    "fontBody": theme.fontBody
  },
  rating,
  reviewCount,
  purchaseUrl,
  email,
  heroImagePrompt,
  aboutImagePrompt,
  ogImagePrompt,
  "logo": logo{ "asset": asset->{ url } },
  "faviconUrl": favicon.asset->url,
  seo{ metaTitle, metaDescription, "ogImageUrl": ogImage.asset->url },
  "sections": sections[]{
    _type,
    _key,
    ...,
    "imageUrl": image.asset->url,
    "imageUrlB": imageB.asset->url,
    "imageUrlC": imageC.asset->url,
    "reviews": reviews[]->{
      author,
      rating,
      text,
      featured,
      order,
      initials,
      location,
      source,
      date,
      "avatar": avatar{ "asset": asset->{ url } }
    },
    "items": items[]{
      platform,
      postUrl,
      caption,
      order,
      "thumbnailUrl": thumbnail.asset->url
    }
  }
}`;

const BUILDSELL_BY_ID_QUERY = `*[_type=="buildsellSite" && buildsellSiteId==$id][0]${BUILDSELL_PROJECTION}`;
const BUILDSELL_BY_SLUG_QUERY = `*[_type=="buildsellSite" && slug.current==$slug && draftMode==false][0]${BUILDSELL_PROJECTION}`;
// Preview resolves drafts too, so no draftMode filter here (see fetchBuildSellSitePreview).
const BUILDSELL_PREVIEW_BY_SLUG_QUERY = `*[_type=="buildsellSite" && slug.current==$slug][0]${BUILDSELL_PROJECTION}`;

export interface BuildSellTheme {
  layoutVariant: 'split' | 'bold' | 'trust';
  preset?: string | null;
  fontHeading?: string | null;
  fontBody?: string | null;
}

export interface BuildSellNavLink {
  label: string;
  href: string;
}

export interface BuildSellReview {
  author: string;
  rating: number;
  text: string;
  featured?: boolean | null;
  order?: number | null;
  initials?: string | null;
  location?: string | null;
  /** Presentation label only. Never 'google' on a generated testimonial (ToS guard). */
  source?: 'manual' | 'google' | 'facebook' | null;
  date?: string | null;
  avatar?: { asset?: { url?: string | null } | null } | null;
}

export interface BuildSellSection {
  _type: string;
  _key: string;
  // bsHeroSection
  eyebrow?: string | null;
  headline?: string | null;
  highlight?: string | null;
  subhead?: string | null;
  imageUrl?: string | null;
  /** Trust-variant hero strip tiles 2 & 3 (auto-filled from the hero prompt). */
  imageUrlB?: string | null;
  imageUrlC?: string | null;
  showRating?: boolean | null;
  badges?: Array<{ icon?: string | null; label?: string | null }> | null;
  primaryCta?: { label?: string | null; href?: string | null; style?: string | null } | null;
  secondaryCta?: { label?: string | null; href?: string | null } | null;
  // bsServicesSection
  heading?: string | null;
  services?: Array<{ icon?: string | null; title?: string | null; description?: string | null; link?: string | null }> | null;
  // bsAboutSection
  body?: string | null;
  stats?: Array<{ value?: string | null; label?: string | null }> | null;
  cta?: { label?: string | null; href?: string | null; style?: string | null } | null;
  // bsProcessSection
  steps?: Array<{ icon?: string | null; title?: string | null; description?: string | null }> | null;
  // bsReviewsSection
  reviews?: BuildSellReview[] | null;
  // bsContactSection
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    hours?: string | null;
    serviceArea?: string | null;
  } | null;
  formLabels?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    message?: string | null;
    submit?: string | null;
  } | null;
  formEndpoint?: string | null;
  showDetails?: boolean | null;
  showMap?: boolean | null;
  // bsFooterSection
  tagline?: string | null;
  columns?: Array<{
    heading?: string | null;
    links?: Array<{ label?: string | null; href?: string | null }> | null;
  }> | null;
  social?: Array<{ platform?: string | null; href?: string | null }> | null;
  legal?: string | null;
  legalLinks?: Array<{ label?: string | null; href?: string | null }> | null;
  // bsUgcSection
  items?: Array<{
    platform?: string | null;
    postUrl?: string | null;
    caption?: string | null;
    order?: number | null;
    thumbnailUrl?: string | null;
  }> | null;
}

export interface BuildSellSite {
  _id: string;
  buildsellSiteId: string;
  businessName: string;
  trade: string;
  city: string;
  state: string;
  phone?: string | null;
  placeId?: string | null;
  slug: string;
  draftMode?: boolean | null;
  themeLocked?: boolean | null;
  robotsDisallow?: boolean | null;
  generatedAt?: string | null;
  navigation?: BuildSellNavLink[] | null;
  navShowPhone?: boolean | null;
  navCta?: { label?: string | null; href?: string | null; style?: string | null } | null;
  theme: BuildSellTheme;
  seo?: { metaTitle?: string | null; metaDescription?: string | null; ogImageUrl?: string | null } | null;
  sections?: BuildSellSection[] | null;
  rating?: number | null;
  reviewCount?: number | null;
  purchaseUrl?: string | null;
  email?: string | null;
  heroImagePrompt?: string | null;
  aboutImagePrompt?: string | null;
  ogImagePrompt?: string | null;
  logo?: { asset?: { url?: string | null } | null } | null;
  faviconUrl?: string | null;
}

/**
 * Strip stega watermarks from structural (non-display) fields ONLY.
 *
 * Stega injects invisible Unicode chars into every string the `sanityStega`
 * client returns. Fields used as switch values, CSS class fragments, icon
 * names, href attributes, or any JS logic must be cleaned or comparisons break
 * and icons/links silently fail. Display text (headlines, body copy, labels,
 * review text, business name, etc.) is intentionally left stega-encoded so the
 * Presentation overlay can pinpoint clickable regions.
 *
 * Fields cleaned and why:
 *   theme.layoutVariant  — switch('split'|'bold'|'trust') in every block component
 *   theme.preset         — presetByName() lookup in buildsell-theme.ts
 *   theme.fontHeading    — resolveBsFont() lookup + CSS var reference
 *   theme.fontBody       — resolveBsFont() lookup + CSS var reference
 *   section._type        — switch statement in BuildSellHome render loop
 *   section._key         — React key prop (must be stable identifier)
 *   badge.icon / step.icon / service.icon — lucide icon lookup via Icon.tsx
 *   social[].platform    — socialIconName() map lookup in FooterBlock
 *   ugc items[].platform — platformIcon() map lookup in UgcBlock
 *   navCta.style         — conditionally used as href fallback check
 *   cta.style            — 'secondary'|'ghost' class selection in AboutBlock
 *   primaryCta.style     — same pattern in HeroBlock
 *   review.source        — 'google'|'manual'|'facebook' display label
 *   navigation[].href    — rendered as href attribute
 *   navCta.href          — href attribute
 *   section link hrefs   — href attributes in service/footer links
 */
export function stegaCleanStructural(site: BuildSellSite): BuildSellSite {
  return {
    ...site,
    theme: {
      ...site.theme,
      layoutVariant: stegaClean(site.theme.layoutVariant),
      preset: site.theme.preset != null ? stegaClean(site.theme.preset) : site.theme.preset,
      fontHeading: site.theme.fontHeading != null ? stegaClean(site.theme.fontHeading) : site.theme.fontHeading,
      fontBody: site.theme.fontBody != null ? stegaClean(site.theme.fontBody) : site.theme.fontBody,
    },
    navigation: site.navigation?.map((link) => ({
      ...link,
      href: stegaClean(link.href),
    })),
    navCta: site.navCta
      ? {
          ...site.navCta,
          href: site.navCta.href != null ? stegaClean(site.navCta.href) : site.navCta.href,
          style: site.navCta.style != null ? stegaClean(site.navCta.style) : site.navCta.style,
        }
      : site.navCta,
    sections: site.sections?.map((section) => ({
      ...section,
      _type: stegaClean(section._type),
      _key: stegaClean(section._key),
      // icon fields in badges, steps, services
      badges: section.badges?.map((b) => ({
        ...b,
        icon: b.icon != null ? stegaClean(b.icon) : b.icon,
      })),
      steps: section.steps?.map((s) => ({
        ...s,
        icon: s.icon != null ? stegaClean(s.icon) : s.icon,
      })),
      services: section.services?.map((s) => ({
        ...s,
        icon: s.icon != null ? stegaClean(s.icon) : s.icon,
        link: s.link != null ? stegaClean(s.link) : s.link,
      })),
      // CTA hrefs and style selectors
      primaryCta: section.primaryCta
        ? {
            ...section.primaryCta,
            href: section.primaryCta.href != null ? stegaClean(section.primaryCta.href) : section.primaryCta.href,
            style: section.primaryCta.style != null ? stegaClean(section.primaryCta.style) : section.primaryCta.style,
          }
        : section.primaryCta,
      secondaryCta: section.secondaryCta
        ? {
            ...section.secondaryCta,
            href: section.secondaryCta.href != null ? stegaClean(section.secondaryCta.href) : section.secondaryCta.href,
          }
        : section.secondaryCta,
      cta: section.cta
        ? {
            ...section.cta,
            href: section.cta.href != null ? stegaClean(section.cta.href) : section.cta.href,
            style: section.cta.style != null ? stegaClean(section.cta.style) : section.cta.style,
          }
        : section.cta,
      // Social platform names (used as icon map keys)
      social: section.social?.map((s) => ({
        ...s,
        platform: s.platform != null ? stegaClean(s.platform) : s.platform,
        href: s.href != null ? stegaClean(s.href) : s.href,
      })),
      // UGC platform names (used as icon map keys) and URLs
      items: section.items?.map((it) => ({
        ...it,
        platform: it.platform != null ? stegaClean(it.platform) : it.platform,
        postUrl: it.postUrl != null ? stegaClean(it.postUrl) : it.postUrl,
      })),
      // Footer link hrefs
      columns: section.columns?.map((col) => ({
        ...col,
        links: col.links?.map((l) => ({
          ...l,
          href: l.href != null ? stegaClean(l.href) : l.href,
        })),
      })),
      legalLinks: section.legalLinks?.map((l) => ({
        ...l,
        href: l.href != null ? stegaClean(l.href) : l.href,
      })),
    })),
  };
}

export async function fetchBuildSellSiteById(id: string): Promise<BuildSellSite | null> {
  // Import lazily to avoid pulling SanityLive/stega into the public route bundle.
  // This module is server-only; the dynamic import resolves at build time in
  // the server bundle and does not create a client-side chunk.
  const { sanityFetch } = await import('./sanity-live');
  const { data } = await sanityFetch({
    query: BUILDSELL_BY_ID_QUERY,
    params: { id },
  });
  const site = data as BuildSellSite | null;
  if (!site) return null;
  return stegaCleanStructural(site);
}

/** Postgres UUID shape — distinguishes legacy /preview/<uuid> links from /preview/<slug>. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a buildsell site for the preview route by EITHER its Postgres UUID
 * (legacy /preview/<uuid> links stay valid) or its human-readable slug
 * (/preview/<slug>). Unlike fetchBuildSellSiteBySlug, this does NOT filter on
 * draftMode==false — the preview route always renders draft=true regardless of
 * the doc's live state, so a draft must resolve by slug here.
 */
export async function fetchBuildSellSitePreview(idOrSlug: string): Promise<BuildSellSite | null> {
  if (UUID_RE.test(idOrSlug)) {
    return fetchBuildSellSiteById(idOrSlug);
  }
  const result = await sanity.fetch<BuildSellSite | null>(
    BUILDSELL_PREVIEW_BY_SLUG_QUERY,
    { slug: idOrSlug },
  );
  return result ?? null;
}

export async function fetchBuildSellSiteBySlug(slug: string): Promise<BuildSellSite | null> {
  const result = await sanity.fetch<BuildSellSite | null>(BUILDSELL_BY_SLUG_QUERY, { slug });
  return result ?? null;
}

/** Minimal stub returned by fetchBuildSellSitemapEntries. */
export interface BuildSellSitemapStub {
  slug: string;
  updatedAt: string;
}

const BUILDSELL_SITEMAP_QUERY = `*[_type=="buildsellSite" && draftMode==false && robotsDisallow==false && defined(slug.current)]{
  "slug": slug.current,
  "updatedAt": _updatedAt
}`;

/**
 * Fetch slugs + timestamps for all live (paid, indexable) buildsell spec sites.
 * Used by sitemap.ts to emit /buildsell/{slug} entries.
 */
export async function fetchBuildSellSitemapEntries(): Promise<BuildSellSitemapStub[]> {
  const result = await sanity.fetch<BuildSellSitemapStub[] | null>(BUILDSELL_SITEMAP_QUERY, {});
  return result ?? [];
}
