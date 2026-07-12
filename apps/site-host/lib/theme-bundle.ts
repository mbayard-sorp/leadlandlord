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
    hero_image_alt: site.heroImageAlt ?? undefined,
    video_url: site.videoUrl ?? undefined,
    video_description: site.videoDescription ?? undefined,
    longform_body: site.longformBody ?? undefined,
    logo_url: site.logoUrl ?? undefined,
    favicon_url: site.faviconUrl ?? undefined,
    nearby_cities: site.nearbyCities ?? [],
    trust_signals: site.trustSignals ?? [],
    // Structured-data geo/sameAs. Phase 2 adds the Sanity fields + GROQ
    // projection that populate these; until then they're absent (geo) / empty
    // (sameAs) so the JSON-LD emitters simply skip the geo + sameAs nodes.
    latitude: site.latitude ?? undefined,
    longitude: site.longitude ?? undefined,
    same_as: site.sameAs ?? [],
    // Operator-entered business hours, passed through verbatim (Sanity-only
    // field, no ContentBundle equivalent — see ADR). Absent unless both
    // opens/closes are set; the JSON-LD emitter falls back to a hardcoded
    // default range when unset.
    opening_hours:
      site.openingHours?.opens && site.openingHours?.closes
        ? {
            opens: site.openingHours.opens,
            closes: site.openingHours.closes,
            closed_days: site.openingHours.closedDays ?? undefined,
          }
        : undefined,
    home: pageToBundlePage(site.home, 'home'),
    about: pageToBundlePage(site.about, 'about') ?? blank,
    contact: pageToBundlePage(site.contact, 'contact') ?? blank,
    services: (site.services ?? []).map((p) => pageToBundlePage(p, 'service')),
    service_areas: (site.serviceAreas ?? []).map((p) => pageToBundlePage(p, 'service_area')),
    blog_posts: (site.blogPosts ?? []).map((p) => pageToBundlePage(p, 'blog')),
    info_pages: (site.infoPages ?? []).map((p) => pageToBundlePage(p, 'info')),
    faq_pages: (site.faqPages ?? []).map((p) => pageToBundlePage(p, 'faq')),
    generated_at: site.generatedAt ?? new Date().toISOString(),
    // Trust-signal fields — safe defaults ensure existing tenants render identically (ADR 0003)
    reviews: (site.reviews ?? []).map((r) => ({
      author: r.author,
      rating: r.rating,
      text: r.text,
      source: r.source,
      date: r.date,
      verified: r.verified ?? false,
    })),
    aggregate_rating: site.aggregateRating
      ? {
          rating_value: site.aggregateRating.ratingValue,
          review_count: site.aggregateRating.reviewCount,
          best_rating: site.aggregateRating.bestRating ?? 5,
        }
      : undefined,
    license_number: site.licenseNumber ?? undefined,
    insurance_carrier: site.insuranceCarrier ?? undefined,
    years_in_business: site.yearsInBusiness ?? undefined,
    response_time_promise: site.responseTimePromise ?? undefined,
    certifications: (site.certifications ?? []).map((c) => ({
      name: c.name,
      issuer: c.issuer ?? undefined,
      year: c.year ?? undefined,
    })),
    photo_gallery: (site.photoGallery ?? []).filter((g) => !!g.url).map((g) => ({
      url: g.url,
      alt: g.alt,
      caption: g.caption ?? undefined,
    })),
    guarantees: site.guarantees ?? [],
    neighborhoods: (site.neighborhoods ?? []).map((n) => ({
      name: n.name,
      googleMapsUrl: n.googleMapsUrl,
    })),
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
    og_image_url: p.articleImageUrl ?? p.pageOgImageUrl ?? undefined,
    og_image_alt: p.articleImageAlt ?? undefined,
    date_modified: p.dateModified ?? undefined,
    faqs: (p.faqs ?? []).map((f) => ({ q: f.q, a: f.a })),
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
