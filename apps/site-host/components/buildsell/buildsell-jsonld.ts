/**
 * Pure schema.org node builders for the Build & Sell WebSite / Service / Offer
 * JSON-LD components. Kept out of the component files so the section-finding
 * and price-parsing logic is unit-testable without a React/JSX transform —
 * mirrors components/shared/local-business-schema.ts.
 */
import type { BuildSellSection, BuildSellSite } from '@/lib/sanity';

export function findBuildSellSection(
  sections: BuildSellSection[] | null | undefined,
  type: string,
): BuildSellSection | undefined {
  return sections?.find((s) => s._type === type);
}

// ---------------------------------------------------------------------------
// WebSite
// ---------------------------------------------------------------------------

export interface WebSiteNode {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  '@id': string;
  name: string;
  url: string;
  publisher: { '@id': string };
}

/** Builds the WebSite node, or null when the site has no name to anchor it to. */
export function buildWebSiteNode(site: BuildSellSite, origin: string): WebSiteNode | null {
  if (!site.businessName) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: site.businessName,
    url: `${origin}/`,
    publisher: { '@id': `${origin}/#localbusiness` },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ServiceNode {
  '@context': 'https://schema.org';
  '@type': 'Service';
  name: string;
  description?: string;
  url?: string;
  provider: { '@id': string };
}

/** Resolve a possibly-relative service card link against the site origin. */
function absolutizeLink(link: string | null | undefined, origin: string): string | undefined {
  if (!link?.trim()) return undefined;
  try {
    return new URL(link, origin).toString();
  } catch {
    return undefined;
  }
}

/**
 * Builds one Service node per card in the bsServicesSection. Returns null
 * when the section is missing or has no titled cards.
 */
export function buildServiceNodes(
  sections: BuildSellSection[] | null | undefined,
  origin: string,
): ServiceNode[] | null {
  const section = findBuildSellSection(sections, 'bsServicesSection');
  const cards = section?.services?.filter((c) => c.title?.trim());
  if (!cards || cards.length === 0) return null;

  return cards.map((card) => {
    const node: ServiceNode = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: card.title!.trim(),
      provider: { '@id': `${origin}/#localbusiness` },
    };
    if (card.description?.trim()) node.description = card.description.trim();
    const url = absolutizeLink(card.link, origin);
    if (url) node.url = url;
    return node;
  });
}

// ---------------------------------------------------------------------------
// Offer / AggregateOffer
// ---------------------------------------------------------------------------

export interface OfferNode {
  '@type': 'Offer';
  name: string;
  description?: string;
  price?: number;
  priceCurrency?: string;
  itemOffered?: { '@type': 'Service'; name: string };
}

export interface AggregateOfferNode {
  '@context': 'https://schema.org';
  '@type': 'AggregateOffer';
  priceCurrency?: string;
  lowPrice?: number;
  highPrice?: number;
  offers: OfferNode[];
}

/**
 * Parse a free-text tier price like "$150/hr", "$1,200", "Custom" into a
 * numeric value. Returns null when nothing numeric can be extracted — callers
 * must omit the price field in that case rather than fabricate a number.
 */
export function parseTierPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds an AggregateOffer from the bsPricingSection tiers. Returns null when
 * there's no pricing section or no named tiers. Numeric lowPrice/highPrice
 * are omitted entirely when no tier price is parseable; individual Offers
 * still carry name/description even without a parseable price.
 *
 * Best-effort service<->tier linkage: when a tier name case-insensitively
 * matches a service card title, the Offer's itemOffered references that
 * Service by name.
 */
export function buildAggregateOfferNode(
  sections: BuildSellSection[] | null | undefined,
  origin: string,
): AggregateOfferNode | null {
  const pricingSection = findBuildSellSection(sections, 'bsPricingSection');
  const tiers = pricingSection?.tiers?.filter((t) => t.name?.trim());
  if (!tiers || tiers.length === 0) return null;

  const servicesSection = findBuildSellSection(sections, 'bsServicesSection');
  const serviceTitles = new Map<string, string>();
  for (const svc of servicesSection?.services ?? []) {
    if (svc.title?.trim()) serviceTitles.set(svc.title.trim().toLowerCase(), svc.title.trim());
  }

  const offers: OfferNode[] = tiers.map((tier) => {
    const name = tier.name!.trim();
    const offer: OfferNode = { '@type': 'Offer', name };
    if (tier.description?.trim()) offer.description = tier.description.trim();

    const price = parseTierPrice(tier.price);
    if (price !== null) {
      offer.price = price;
      offer.priceCurrency = 'USD';
    }

    const matchedTitle = serviceTitles.get(name.toLowerCase());
    if (matchedTitle) {
      offer.itemOffered = { '@type': 'Service', name: matchedTitle };
    }

    return offer;
  });

  const parsedPrices = offers
    .map((o) => o.price)
    .filter((p): p is number => typeof p === 'number');

  const node: AggregateOfferNode = {
    '@context': 'https://schema.org',
    '@type': 'AggregateOffer',
    offers,
  };

  if (parsedPrices.length > 0) {
    node.priceCurrency = 'USD';
    node.lowPrice = Math.min(...parsedPrices);
    node.highPrice = Math.max(...parsedPrices);
  }

  return node;
}
