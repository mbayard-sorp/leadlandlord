import type { Bundle, Page, Variant } from './content';
import type { SanitySite, SanitySitePage } from './sanity';

/**
 * Adapt a Sanity site doc into the legacy `Bundle` shape used by the variant
 * components. The variant components stay portable — only this file knows
 * about Sanity field naming.
 */
export function sanityToBundle(site: SanitySite): Bundle {
  const blank = blankPage();
  return {
    niche: site.niche ?? '',
    city: site.city ?? '',
    state: site.state ?? '',
    business_name: site.businessName ?? '',
    variant: (site.theme ?? 'classic') as Variant,
    hero_image_prompt: site.heroImagePrompt ?? undefined,
    hero_image_url: site.heroImageUrl ?? undefined,
    nearby_cities: site.nearbyCities ?? [],
    trust_signals: site.trustSignals ?? [],
    home: pageToBundlePage(site.home, 'home'),
    about: pageToBundlePage(site.about, 'about') ?? blank,
    contact: pageToBundlePage(site.contact, 'contact') ?? blank,
    services: (site.services ?? []).map((p) => pageToBundlePage(p, 'service')),
    service_areas: (site.serviceAreas ?? []).map((p) => pageToBundlePage(p, 'service_area')),
    blog_posts: (site.blogPosts ?? []).map((p) => pageToBundlePage(p, 'blog')),
    info_pages: (site.infoPages ?? []).map((p) => pageToBundlePage(p, 'info')),
    generated_at: site.generatedAt ?? new Date().toISOString(),
  };
}

function pageToBundlePage(p: SanitySitePage | undefined | null, fallbackKind: string): Page {
  if (!p) return blankPage(fallbackKind);
  let jsonLd: unknown = undefined;
  if (p.jsonLd) {
    if (typeof p.jsonLd === 'string') {
      try { jsonLd = JSON.parse(p.jsonLd); } catch { jsonLd = undefined; }
    } else {
      jsonLd = p.jsonLd;
    }
  }
  return {
    kind: p.kind ?? fallbackKind,
    slug: p.slug ?? '',
    title: p.title ?? '',
    meta_description: p.metaDescription ?? '',
    mdx: p.mdx ?? '',
    schema_org_jsonld: jsonLd,
  };
}

function blankPage(kind = 'home'): Page {
  return {
    kind,
    slug: '/',
    title: '',
    meta_description: '',
    mdx: '',
  };
}
