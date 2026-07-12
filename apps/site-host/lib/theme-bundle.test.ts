import { describe, expect, it } from 'vitest';
import { sanityToBundle } from './theme-bundle';
import type { SanitySite, SanitySitePage } from './sanity';

function page(kind: string): SanitySitePage {
  return {
    _id: `page-${kind}`,
    kind,
    slug: kind,
    title: kind,
    metaDescription: '',
    mdx: '',
  };
}

function minimalSite(overrides: Partial<SanitySite> = {}): SanitySite {
  return {
    _id: 'site-1',
    siteId: 'site-1',
    slug: 'acme-plumbing',
    businessName: 'Acme Plumbing',
    niche: 'plumbing',
    city: 'Henderson',
    state: 'NV',
    theme: 'classic',
    home: page('home'),
    about: page('about'),
    contact: page('contact'),
    ...overrides,
  };
}

describe('sanityToBundle — geo/sameAs passthrough', () => {
  it('carries latitude/longitude through when both are present', () => {
    const bundle = sanityToBundle(minimalSite({ latitude: 36.02, longitude: -115.03 }));
    expect(bundle.latitude).toBe(36.02);
    expect(bundle.longitude).toBe(-115.03);
  });

  it('leaves latitude/longitude undefined when absent', () => {
    const bundle = sanityToBundle(minimalSite());
    expect(bundle.latitude).toBeUndefined();
    expect(bundle.longitude).toBeUndefined();
  });

  it('carries sameAs through, defaulting to an empty array', () => {
    expect(sanityToBundle(minimalSite()).same_as).toEqual([]);
    expect(
      sanityToBundle(minimalSite({ sameAs: ['https://g.page/acme'] })).same_as,
    ).toEqual(['https://g.page/acme']);
  });
});

describe('sanityToBundle — opening_hours mapping', () => {
  it('is undefined when the site has no openingHours', () => {
    expect(sanityToBundle(minimalSite()).opening_hours).toBeUndefined();
  });

  it('maps opens/closes/closedDays to snake_case opening_hours', () => {
    const bundle = sanityToBundle(
      minimalSite({
        openingHours: { opens: '08:00', closes: '17:00', closedDays: ['Sunday'] },
      }),
    );
    expect(bundle.opening_hours).toEqual({
      opens: '08:00',
      closes: '17:00',
      closed_days: ['Sunday'],
    });
  });

  it('omits closed_days when closedDays is absent', () => {
    const bundle = sanityToBundle(
      minimalSite({ openingHours: { opens: '08:00', closes: '17:00' } }),
    );
    expect(bundle.opening_hours).toEqual({ opens: '08:00', closes: '17:00', closed_days: undefined });
  });

  it('is undefined when only one of opens/closes is set', () => {
    expect(
      sanityToBundle(minimalSite({ openingHours: { opens: '08:00' } })).opening_hours,
    ).toBeUndefined();
    expect(
      sanityToBundle(minimalSite({ openingHours: { closes: '17:00' } })).opening_hours,
    ).toBeUndefined();
  });
});

describe('sanityToBundle — image alt text mapping', () => {
  it('carries hero_image_alt through when present', () => {
    const bundle = sanityToBundle(minimalSite({ heroImageAlt: 'Roofer on a ladder in Henderson' }));
    expect(bundle.hero_image_alt).toBe('Roofer on a ladder in Henderson');
  });

  it('leaves hero_image_alt undefined when absent', () => {
    expect(sanityToBundle(minimalSite()).hero_image_alt).toBeUndefined();
  });

  it('maps a page articleImageAlt to og_image_alt when present', () => {
    const bundle = sanityToBundle(
      minimalSite({ home: { ...page('home'), articleImageAlt: 'Clogged gutter close-up' } }),
    );
    expect(bundle.home.og_image_alt).toBe('Clogged gutter close-up');
  });

  it('leaves og_image_alt undefined when articleImageAlt is absent', () => {
    expect(sanityToBundle(minimalSite()).home.og_image_alt).toBeUndefined();
  });
});
