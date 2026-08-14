import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { resolveCurrentSite } from '../lib/site-context';
import { resolveCurrentBuildSellSite } from '../lib/buildsell-context';
import { sanityToBundle } from '../lib/theme-bundle';
import { fetchCorporatePageList, fetchBuildSellSitemapEntries } from '../lib/sanity';
import {
  fetchCustomSiteByKey,
  fetchCustomSitePages,
  fetchCustomSitePracticeAreas,
  fetchCustomSitePublications,
  fetchCustomSiteJourneyStages,
  fetchCustomSiteAttorneys,
} from '../lib/customsites-sanity';
import { csSitePaths, csSiteFeatures } from '../lib/customsites-registry';
import type { Page } from '../lib/content';
import { pageHref } from '../lib/content';

// Corporate (leadslandlord.com) page kind → clean URL path + crawl hints.
// Browser URLs are bare (proxy.ts rewrites them into /leadslandlord/*), so the
// sitemap advertises the public path, not the internal namespace.
const CORPORATE_KIND_META: Record<
  string,
  { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }
> = {
  home: { path: '/', changeFrequency: 'weekly', priority: 1 },
  services: { path: '/services', changeFrequency: 'monthly', priority: 0.8 },
  pricing: { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  about: { path: '/about', changeFrequency: 'monthly', priority: 0.5 },
  contact: { path: '/contact', changeFrequency: 'monthly', priority: 0.5 },
  privacy: { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  terms: { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
};

// Build a canonical sitemap URL. The site canonicalizes to NO trailing slash
// (Next.js trailingSlash: false), so trailing-slash URLs 308-redirect. Sitemaps
// must list the 200 target directly, not the redirect. Homepage stays "/".
function canonical(base: string, path: string): string {
  const slug = path.startsWith('/') ? path : `/${path}`;
  const stripped = slug.replace(/\/+$/, '');
  return `${base}${stripped === '' ? '/' : stripped}`;
}

async function corporateSitemap(base: string): Promise<MetadataRoute.Sitemap> {
  const [pages, bsEntries] = await Promise.all([
    fetchCorporatePageList(),
    fetchBuildSellSitemapEntries(),
  ]);

  const corporateEntries: MetadataRoute.Sitemap = pages
    .map((p) => {
      const meta = CORPORATE_KIND_META[p.kind];
      if (!meta) return null;
      const url = canonical(base, meta.path);
      return {
        url,
        lastModified: p.updatedAt ? new Date(p.updatedAt) : new Date(),
        changeFrequency: meta.changeFrequency,
        priority: meta.priority,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const buildsellEntries: MetadataRoute.Sitemap = bsEntries.map((entry) => ({
    url: canonical(base, `/buildsell/${entry.slug}`),
    lastModified: entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...corporateEntries, ...buildsellEntries];
}

// Heuristic-only: csPage has no "kind"/category field to distinguish a legal
// or utility page (privacy, terms, etc.) from a regular content page, so this
// slug allowlist stands in until Phase 3's page model settles. Revisit if the
// real slugs diverge from this set.
const CUSTOM_UTILITY_PAGE_SLUGS = new Set([
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'terms-and-conditions',
  'disclaimer',
  'accessibility',
  'cookie-policy',
]);

/**
 * Custom Sites sitemap (ADR 0033). No pagination assumed yet — Phase 3's
 * route tree isn't built, so page paths here are the provisional convention
 * (flat /<slug> for csPage, /practice-areas/<slug>, /publications/<slug>).
 * Returns [] when the site doesn't resolve or is robots-disallowed, matching
 * the tenant/B&S warming-site behavior above.
 */
async function customSitemap(base: string, siteKey: string): Promise<MetadataRoute.Sitemap> {
  const site = await fetchCustomSiteByKey(siteKey);
  if (!site || site.robotsDisallow) return [];

  const { servicesPath, insightsPath } = csSitePaths(siteKey);
  const { journeyPages, teamPages } = csSiteFeatures(siteKey);
  const [pages, practiceAreas, publications, journeyStages, teamMembers] = await Promise.all([
    fetchCustomSitePages(siteKey),
    fetchCustomSitePracticeAreas(siteKey),
    fetchCustomSitePublications(siteKey),
    journeyPages ? fetchCustomSiteJourneyStages(siteKey) : Promise.resolve([]),
    teamPages ? fetchCustomSiteAttorneys(siteKey) : Promise.resolve([]),
  ]);

  const lastModifiedOf = (modifiedAt?: string | null, publishedAt?: string | null): Date =>
    modifiedAt ? new Date(modifiedAt) : publishedAt ? new Date(publishedAt) : new Date();

  const home: MetadataRoute.Sitemap[number] = {
    url: canonical(base, '/'),
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: 1.0,
  };

  const pageEntries: MetadataRoute.Sitemap = pages.map((p) => ({
    url: canonical(base, `/${p.slug}`),
    lastModified: lastModifiedOf(p.modifiedAt, p.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: CUSTOM_UTILITY_PAGE_SLUGS.has(p.slug) ? 0.3 : 0.6,
  }));

  const practiceAreaEntries: MetadataRoute.Sitemap = practiceAreas.map((p) => ({
    url: canonical(base, `/${servicesPath}/${p.slug}`),
    lastModified: lastModifiedOf(p.modifiedAt, p.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.9,
  }));

  const publicationsIndex: MetadataRoute.Sitemap = publications.length
    ? [{ url: canonical(base, `/${insightsPath}`), lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.7 }]
    : [];

  const publicationEntries: MetadataRoute.Sitemap = publications.map((p) => ({
    url: canonical(base, `/${p.slug}`),
    lastModified: lastModifiedOf(p.modifiedAt, p.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  // Optional per-site surfaces (registry-gated) — [] for sites without them,
  // so site #1's sitemap is byte-identical to its pre-registry output.
  const journeyEntries: MetadataRoute.Sitemap = journeyStages.map((stage) => ({
    url: canonical(base, `/journey/${stage.slug}`),
    lastModified: new Date(),
    changeFrequency: 'yearly' as const,
    priority: 0.5,
  }));

  const teamEntries: MetadataRoute.Sitemap = teamMembers.map((member) => ({
    url: canonical(base, `/team/${member.slug}`),
    lastModified: new Date(),
    changeFrequency: 'yearly' as const,
    priority: 0.4,
  }));

  return [
    home,
    ...pageEntries,
    ...practiceAreaEntries,
    ...publicationsIndex,
    ...publicationEntries,
    ...journeyEntries,
    ...teamEntries,
  ];
}

// Cache the rendered sitemap for an hour. Without this, every Googlebot
// fetch is a server-rendered round-trip through Sanity, and a cold start +
// slow Sanity call can exceed Google's fetch budget — surfacing in GSC as
// "general HTTP error" / "couldn't read sitemap" even though our own curl
// returns 200. ISR at the route handler level means subsequent fetches hit
// Vercel's edge cache; only one renderer behind it ever touches Sanity per
// revalidate window.
export const revalidate = 3600;

/**
 * Per-host dynamic sitemap. Site-host is multi-tenant — sitemap.xml resolves
 * to the current host's Sanity content.
 *
 * Includes every page kind Content Engine emits: home, about, contact, plus
 * services, service-areas, blog, and info pages. Each kind has its own
 * change frequency + priority.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? 'localhost:3001';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  // Corporate marketing site (leadslandlord.com) — proxy.ts sets x-site-mode.
  // Its pages live as corporatePage docs, not a tenant `site` doc, so
  // resolveCurrentSite() returns null here and the tenant branch can't serve it.
  if (h.get('x-site-mode') === 'corporate') {
    return corporateSitemap(base);
  }

  // Custom Sites (ADR 0033) — resolved by siteKey, not a `site`/`buildsellSite`
  // doc, so it needs its own branch ahead of the tenant resolver below.
  if (h.get('x-site-mode') === 'custom') {
    const siteKey = h.get('x-cs-site');
    if (!siteKey) return [];
    return customSitemap(base, siteKey);
  }

  const site = await resolveCurrentSite();
  if (!site) {
    // No R&R site on this host — check whether it's a custom domain attached
    // to a sold B&S spec site. Only the domain root exists there today (no
    // subpages), so a single-entry sitemap or none at all.
    const bsSite = await resolveCurrentBuildSellSite();
    if (!bsSite || bsSite.robotsDisallow) return [];
    return [{ url: `${base}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 }];
  }

  // Warming sites should not advertise a populated sitemap — Googlebot
  // must not crawl them until the tenant is live.
  if (site.robotsDisallow) return [];

  const bundle = sanityToBundle(site);
  const bundleModified = bundle.generated_at ? new Date(bundle.generated_at) : new Date();

  /** Per-page lastModified: prefer the page's own date_modified, fall back to bundle timestamp. */
  const pageModified = (p: Page): Date =>
    p.date_modified ? new Date(p.date_modified) : bundleModified;

  const fixed: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: bundleModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/about`, lastModified: bundleModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/contact`, lastModified: bundleModified, changeFrequency: 'monthly', priority: 0.7 },
    // /blog index only when there are enough posts to avoid thin-content indexing
    ...(bundle.blog_posts.length >= 2
      ? [{ url: `${base}/blog`, lastModified: bundleModified, changeFrequency: 'weekly' as const, priority: 0.6 }]
      : []),
    // /faq hub under the same thin-content gate as the nav + index noindex.
    ...(bundle.faq_pages.length >= 2
      ? [{ url: `${base}/faq`, lastModified: bundleModified, changeFrequency: 'monthly' as const, priority: 0.6 }]
      : []),
  ];

  const services: MetadataRoute.Sitemap = bundle.services.map((p) => ({
    url: `${base}${pageHref(p)}`,
    lastModified: pageModified(p),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  const serviceAreas: MetadataRoute.Sitemap = bundle.service_areas.map((p) => ({
    url: `${base}${pageHref(p)}`,
    lastModified: pageModified(p),
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  const blog: MetadataRoute.Sitemap = bundle.blog_posts.map((p) => ({
    url: `${base}${pageHref(p)}`,
    lastModified: pageModified(p),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  const infoPages: MetadataRoute.Sitemap = bundle.info_pages.map((p) => ({
    url: `${base}${pageHref(p)}`,
    lastModified: pageModified(p),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  const faqPages: MetadataRoute.Sitemap = bundle.faq_pages.map((p) => ({
    url: `${base}${pageHref(p)}`,
    lastModified: pageModified(p),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  return [...fixed, ...services, ...serviceAreas, ...blog, ...infoPages, ...faqPages];
}
