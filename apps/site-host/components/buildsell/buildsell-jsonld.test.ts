import { describe, expect, it } from 'vitest';
import {
  buildAggregateOfferNode,
  buildServiceNodes,
  buildWebSiteNode,
  parseTierPrice,
} from './buildsell-jsonld';
import type { BuildSellSite, BuildSellSection } from '@/lib/sanity';

const ORIGIN = 'https://example.com';

function site(overrides: Partial<BuildSellSite> = {}): BuildSellSite {
  return {
    _id: 'site-1',
    buildsellSiteId: 'bs-1',
    businessName: 'Acme Plumbing',
    trade: 'plumbing',
    city: 'Henderson',
    state: 'NV',
    slug: 'acme-plumbing-henderson-nv-abc123',
    theme: { layoutVariant: 'split' },
    ...overrides,
  } as BuildSellSite;
}

function section(overrides: Partial<BuildSellSection>): BuildSellSection {
  return { _type: 'unknown', _key: 'key-1', ...overrides };
}

describe('buildWebSiteNode', () => {
  it('builds a WebSite node referencing the localbusiness @id', () => {
    const node = buildWebSiteNode(site(), ORIGIN);
    expect(node).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': 'https://example.com/#website',
      name: 'Acme Plumbing',
      url: 'https://example.com/',
      publisher: { '@id': 'https://example.com/#localbusiness' },
    });
  });

  it('returns null when the site has no businessName', () => {
    expect(buildWebSiteNode(site({ businessName: '' }), ORIGIN)).toBeNull();
  });
});

describe('buildServiceNodes', () => {
  it('returns null when there is no services section', () => {
    expect(buildServiceNodes(null, ORIGIN)).toBeNull();
    expect(buildServiceNodes([section({ _type: 'bsHeroSection' })], ORIGIN)).toBeNull();
  });

  it('returns null when the services section has no titled cards', () => {
    const sections = [section({ _type: 'bsServicesSection', services: [] })];
    expect(buildServiceNodes(sections, ORIGIN)).toBeNull();
  });

  it('builds one Service node per titled card, absolutizing relative links', () => {
    const sections = [
      section({
        _type: 'bsServicesSection',
        services: [
          { title: 'Drain Cleaning', description: 'Fast drain service.', link: '/services/drain-cleaning' },
          { title: 'Water Heater Repair', description: null, link: 'https://other.com/water-heaters' },
          { title: '', description: 'skip me — no title', link: null },
        ],
      }),
    ];

    const nodes = buildServiceNodes(sections, ORIGIN);
    expect(nodes).toEqual([
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: 'Drain Cleaning',
        description: 'Fast drain service.',
        url: 'https://example.com/services/drain-cleaning',
        provider: { '@id': 'https://example.com/#localbusiness' },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: 'Water Heater Repair',
        url: 'https://other.com/water-heaters',
        provider: { '@id': 'https://example.com/#localbusiness' },
      },
    ]);
  });

  it('omits url when the card has no link', () => {
    const sections = [
      section({ _type: 'bsServicesSection', services: [{ title: 'Leak Detection', description: null, link: null }] }),
    ];
    const nodes = buildServiceNodes(sections, ORIGIN);
    expect(nodes?.[0]?.url).toBeUndefined();
  });
});

describe('parseTierPrice', () => {
  it('parses a plain dollar amount', () => {
    expect(parseTierPrice('$150')).toBe(150);
  });

  it('parses a per-unit price', () => {
    expect(parseTierPrice('$150/hr')).toBe(150);
  });

  it('parses a comma-separated amount', () => {
    expect(parseTierPrice('$1,200')).toBe(1200);
  });

  it('returns null for non-numeric text', () => {
    expect(parseTierPrice('Custom')).toBeNull();
    expect(parseTierPrice('Call for quote')).toBeNull();
    expect(parseTierPrice(null)).toBeNull();
    expect(parseTierPrice(undefined)).toBeNull();
  });
});

describe('buildAggregateOfferNode', () => {
  it('returns null when there is no pricing section', () => {
    expect(buildAggregateOfferNode(null, ORIGIN)).toBeNull();
    expect(buildAggregateOfferNode([section({ _type: 'bsHeroSection' })], ORIGIN)).toBeNull();
  });

  it('returns null when the pricing section has no named tiers', () => {
    const sections = [section({ _type: 'bsPricingSection', tiers: [] })];
    expect(buildAggregateOfferNode(sections, ORIGIN)).toBeNull();
  });

  it('builds an AggregateOffer with lowPrice/highPrice from parseable tiers', () => {
    const sections = [
      section({
        _type: 'bsPricingSection',
        tiers: [
          { name: 'Basic', price: '$150/hr', description: 'Entry level' },
          { name: 'Premium', price: '$300/hr', description: 'Full service' },
        ],
      }),
    ];
    const node = buildAggregateOfferNode(sections, ORIGIN);
    expect(node).toEqual({
      '@context': 'https://schema.org',
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: 150,
      highPrice: 300,
      offers: [
        { '@type': 'Offer', name: 'Basic', description: 'Entry level', price: 150, priceCurrency: 'USD' },
        { '@type': 'Offer', name: 'Premium', description: 'Full service', price: 300, priceCurrency: 'USD' },
      ],
    });
  });

  it('keeps a non-parseable tier in offers but omits its price, and excludes it from lowPrice/highPrice', () => {
    const sections = [
      section({
        _type: 'bsPricingSection',
        tiers: [
          { name: 'Basic', price: '$150/hr', description: null },
          { name: 'Enterprise', price: 'Custom', description: 'Contact us' },
        ],
      }),
    ];
    const node = buildAggregateOfferNode(sections, ORIGIN);
    expect(node?.lowPrice).toBe(150);
    expect(node?.highPrice).toBe(150);
    expect(node?.offers[1]).toEqual({ '@type': 'Offer', name: 'Enterprise', description: 'Contact us' });
  });

  it('omits AggregateOffer numeric fields entirely when no tier parses', () => {
    const sections = [
      section({
        _type: 'bsPricingSection',
        tiers: [{ name: 'Custom Quote', price: 'Call us', description: null }],
      }),
    ];
    const node = buildAggregateOfferNode(sections, ORIGIN);
    expect(node?.priceCurrency).toBeUndefined();
    expect(node?.lowPrice).toBeUndefined();
    expect(node?.highPrice).toBeUndefined();
    expect(node?.offers).toEqual([{ '@type': 'Offer', name: 'Custom Quote' }]);
  });

  it('links a tier to a matching service card case-insensitively', () => {
    const sections = [
      section({
        _type: 'bsServicesSection',
        services: [{ title: 'Drain Cleaning', description: null, link: null }],
      }),
      section({
        _type: 'bsPricingSection',
        tiers: [{ name: 'drain cleaning', price: '$99', description: null }],
      }),
    ];
    const node = buildAggregateOfferNode(sections, ORIGIN);
    expect(node?.offers[0]?.itemOffered).toEqual({ '@type': 'Service', name: 'Drain Cleaning' });
  });
});
