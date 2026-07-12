import { describe, expect, it } from 'vitest';
import { injectInternalLinks } from './internal-linker';
import type { ContentBundle } from '@leadlandlord/shared/types';

function makePage(
  slug: string,
  kind: string,
  title: string,
  mdx: string,
  keywordOpts?: { primary_keyword?: string; targeted_keywords?: string[]; cluster_key?: string },
): ContentBundle['home'] {
  return {
    kind: kind as ContentBundle['home']['kind'],
    slug,
    title,
    meta_description: `${title} in test city`,
    mdx,
    primary_keyword: keywordOpts?.primary_keyword,
    cluster_key: keywordOpts?.cluster_key,
    targeted_keywords: (keywordOpts?.targeted_keywords ?? []).map((phrase) => ({
      phrase,
      role: 'secondary' as const,
    })),
    faqs: [],
  };
}

function makeBundle(overrides: Partial<ContentBundle> = {}): ContentBundle {
  const services = [
    makePage('/window-cleaning', 'service', 'Window Cleaning', buildServiceMdx('Window Cleaning')),
    makePage('/gutter-cleaning', 'service', 'Gutter Cleaning', buildServiceMdx('Gutter Cleaning')),
    makePage('/pressure-washing', 'service', 'Pressure Washing', buildServiceMdx('Pressure Washing')),
    makePage('/roof-cleaning', 'service', 'Roof Cleaning', buildServiceMdx('Roof Cleaning')),
    makePage('/driveway-cleaning', 'service', 'Driveway Cleaning', buildServiceMdx('Driveway Cleaning')),
  ];

  const homeMdx = `
We provide window cleaning in Baton Rouge. Call (555) 123-4567 for a free quote.

${buildLargeBody(['window cleaning', 'gutter cleaning', 'pressure washing', 'roof cleaning', 'driveway cleaning'])}
`.trim();

  return {
    niche: 'cleaning',
    city: 'Baton Rouge',
    state: 'LA',
    business_name: 'Baton Rouge Clean',
    variant: 'bright',
    nearby_cities: [],
    trust_signals: [],
    same_as: [],
    home: makePage('/', 'home', 'Baton Rouge Cleaning Services', homeMdx),
    about: makePage('/about', 'about', 'About Us', 'We are a local cleaning company.'),
    contact: makePage('/contact', 'contact', 'Contact Us', 'Contact us for a free quote.'),
    services,
    service_areas: [],
    blog_posts: [
      makePage('/blog/how-often-clean-gutters', 'blog', 'How Often Should You Clean Your Gutters?', buildBlogMdx('gutter cleaning')),
    ],
    info_pages: [],
    faq_pages: [],
    neighborhoods: [],
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildServiceMdx(serviceName: string): string {
  // First 100+ words are filler to ensure injection starts after the zone
  const intro = `We offer ${serviceName.toLowerCase()} in Baton Rouge. Call (555) 123-4567 today. `;
  const filler = 'Our team is licensed and insured and ready to help you with all your home exterior needs. We serve all of Baton Rouge and surrounding areas. Free estimates available. ';
  return `${intro}${filler.repeat(3)}\n\n${serviceName} keeps your home looking great. Contact us to schedule service.`;
}

function buildBlogMdx(kw: string): string {
  const intro = `Questions about ${kw} are common. Call (555) 123-4567. `;
  const filler = 'Regular maintenance keeps your home safe and clean. Experts recommend scheduling at least twice a year. ';
  return `${intro}${filler.repeat(3)}\n\nGutter cleaning is important for your home.`;
}

function buildLargeBody(phrases: string[]): string {
  const filler = 'Our local crew is here to help. Licensed and insured and available same week. ';
  let body = filler.repeat(5) + '\n\n';
  for (const phrase of phrases) {
    body += `We also offer ${phrase} services for Baton Rouge homeowners. ${filler}\n\n`;
  }
  return body;
}

function countLinks(mdx: string): number {
  return (mdx.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).length;
}

describe('injectInternalLinks — home page', () => {
  it('home page gets links to all service targets (contact + 5 services = 6 max for this test bundle)', () => {
    const bundle = makeBundle();
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.home.mdx);
    // 5 service pages + 1 contact = 6 possible targets. Quota is 8-12 but
    // the linker is capped by available targets, so expect at least 4 links.
    expect(linkCount).toBeGreaterThanOrEqual(4);
  });

  it('home page with 10+ services reaches ≥8 links', () => {
    // Build a large-enough bundle to hit the 8-link threshold
    const manyServices = Array.from({ length: 10 }, (_, i) =>
      makePage(`/service-${i}`, 'service', `Service ${i} Name`, buildServiceMdx(`Service ${i} Name`)),
    );
    const homeMdx = buildLargeBody(manyServices.map((s) => s.title.toLowerCase()));
    const bundle = makeBundle({
      home: makePage('/', 'home', 'Baton Rouge Cleaning Services', homeMdx),
      services: manyServices,
    });
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.home.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(8);
  });

  it('home page does not link to itself', () => {
    const bundle = makeBundle();
    const result = injectInternalLinks(bundle);
    expect(result.home.mdx).not.toContain('](/)');
  });
});

describe('injectInternalLinks — no self-links', () => {
  it('service page does not link to itself', () => {
    const bundle = makeBundle();
    const result = injectInternalLinks(bundle);
    for (const page of result.services) {
      const selfLink = new RegExp(`\\]\\(${page.slug}\\)`);
      expect(page.mdx).not.toMatch(selfLink);
    }
  });
});

describe('injectInternalLinks — heading protection', () => {
  it('does not inject links inside H2 lines', () => {
    const bundle = makeBundle();
    const result = injectInternalLinks(bundle);
    const allPages = [result.home, ...result.services, ...result.blog_posts, result.contact];
    for (const page of allPages) {
      const lines = page.mdx.split('\n');
      for (const line of lines) {
        if (/^#{1,3}\s/.test(line)) {
          expect(line).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
        }
      }
    }
  });
});

describe('injectInternalLinks — first-100-words protection', () => {
  it('does not inject a link in the first 100 words of the home page', () => {
    const bundle = makeBundle();
    const result = injectInternalLinks(bundle);
    const words = result.home.mdx.split(/\s+/);
    const first100 = words.slice(0, 100).join(' ');
    // No markdown link syntax in first 100 words
    expect(first100).not.toMatch(/\[[^\]]+\]\([^)]+\)/);
  });
});

describe('injectInternalLinks — does not mutate input', () => {
  it('returns a new bundle without modifying the original', () => {
    const bundle = makeBundle();
    const originalHomeMdx = bundle.home.mdx;
    injectInternalLinks(bundle);
    expect(bundle.home.mdx).toBe(originalHomeMdx);
  });
});

// ---------------------------------------------------------------------------
// service_area / faq_pages / info_pages — Phase 3 item 1 extension
// ---------------------------------------------------------------------------

// Body with no natural mentions of any target phrase — forces the linker
// down the "Related services" fallback path, whose bullet order mirrors
// the internal target-ranking order 1:1. This lets tests assert on
// relatedness ranking without depending on paragraph-scan internals.
function buildUnrelatedFillerMdx(): string {
  const filler = 'Our licensed local crew proudly serves homeowners with dependable, on-time results every visit. ';
  return `${filler.repeat(6)}\n\n${filler.repeat(4)}`;
}

function extractLinkSlugsInOrder(mdx: string): string[] {
  const matches = [...mdx.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
  return matches.map((m) => m[1]!);
}

describe('injectInternalLinks — service_area pages', () => {
  const services = [
    makePage('/window-cleaning', 'service', 'Window Cleaning', buildServiceMdx('Window Cleaning'), {
      primary_keyword: 'window cleaning',
    }),
    makePage('/gutter-cleaning', 'service', 'Gutter Cleaning', buildServiceMdx('Gutter Cleaning'), {
      primary_keyword: 'gutter cleaning',
    }),
    makePage('/pressure-washing', 'service', 'Pressure Washing', buildServiceMdx('Pressure Washing'), {
      primary_keyword: 'pressure washing',
    }),
  ];

  it('caps links between 3 and 5 when mentions are naturally present', () => {
    const serviceAreas = [
      makePage(
        '/service-area/downtown',
        'service_area',
        'Downtown Service Area',
        buildLargeBody(['window cleaning', 'gutter cleaning', 'pressure washing']),
        { primary_keyword: 'window cleaning downtown' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: serviceAreas, faq_pages: [], info_pages: [] });
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.service_areas[0]!.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(3);
    expect(linkCount).toBeLessThanOrEqual(5);
  });

  it('never links a service_area page to itself', () => {
    const serviceAreas = [
      makePage(
        '/service-area/downtown',
        'service_area',
        'Downtown Service Area',
        buildLargeBody(['window cleaning', 'gutter cleaning', 'pressure washing']),
        { primary_keyword: 'window cleaning downtown' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: serviceAreas, faq_pages: [], info_pages: [] });
    const result = injectInternalLinks(bundle);
    expect(result.service_areas[0]!.mdx).not.toContain('](/service-area/downtown)');
  });

  it('preferentially targets the most keyword-related service page', () => {
    const serviceAreas = [
      makePage('/service-area/downtown', 'service_area', 'Downtown Service Area', buildUnrelatedFillerMdx(), {
        primary_keyword: 'window cleaning downtown',
      }),
    ];
    const bundle = makeBundle({ services, service_areas: serviceAreas, faq_pages: [], info_pages: [] });
    const result = injectInternalLinks(bundle);
    const slugs = extractLinkSlugsInOrder(result.service_areas[0]!.mdx);
    // 'window cleaning' shares the most signal words with 'window cleaning
    // downtown' (window + cleaning) and must rank ahead of the less-related
    // gutter/pressure-washing services in the fallback bullet list.
    expect(slugs[0]).toBe('/window-cleaning');
    expect(slugs.indexOf('/window-cleaning')).toBeLessThan(slugs.indexOf('/gutter-cleaning'));
    expect(slugs.indexOf('/gutter-cleaning')).toBeLessThan(slugs.indexOf('/pressure-washing'));
  });

  it('links 1-2 nearby (other) service-area pages in addition to related services', () => {
    const serviceAreas = [
      makePage(
        '/service-area/downtown',
        'service_area',
        'Downtown Service Area',
        buildLargeBody(['window cleaning', 'gutter cleaning', 'pressure washing', 'midtown service area', 'uptown service area']),
        { primary_keyword: 'window cleaning downtown' },
      ),
      makePage('/service-area/midtown', 'service_area', 'Midtown Service Area', buildServiceMdx('Midtown'), {
        primary_keyword: 'window cleaning midtown',
      }),
      makePage('/service-area/uptown', 'service_area', 'Uptown Service Area', buildServiceMdx('Uptown'), {
        primary_keyword: 'window cleaning uptown',
      }),
    ];
    const bundle = makeBundle({ services, service_areas: serviceAreas, faq_pages: [], info_pages: [] });
    const result = injectInternalLinks(bundle);
    const mdx = result.service_areas[0]!.mdx;
    const linkedAreaSlugs = ['/service-area/midtown', '/service-area/uptown'].filter((slug) =>
      mdx.includes(`](${slug})`),
    );
    expect(linkedAreaSlugs.length).toBeGreaterThanOrEqual(1);
    expect(linkedAreaSlugs.length).toBeLessThanOrEqual(2);
  });
});

describe('injectInternalLinks — faq_pages', () => {
  const services = [
    makePage('/window-cleaning', 'service', 'Window Cleaning', buildServiceMdx('Window Cleaning'), {
      primary_keyword: 'window cleaning',
    }),
    makePage('/gutter-cleaning', 'service', 'Gutter Cleaning', buildServiceMdx('Gutter Cleaning'), {
      primary_keyword: 'gutter cleaning',
    }),
  ];
  const infoPages = [
    makePage(
      '/pages/window-cleaning-tips',
      'info',
      'Window Cleaning Maintenance Tips',
      buildServiceMdx('Window Cleaning Maintenance Tips'),
      { primary_keyword: 'window cleaning tips' },
    ),
  ];

  it('caps links between 1 and 3', () => {
    const faqPages = [
      makePage(
        '/faq/how-much-does-window-cleaning-cost',
        'faq',
        'How Much Does Window Cleaning Cost?',
        buildLargeBody(['window cleaning', 'gutter cleaning', 'window cleaning tips']),
        { primary_keyword: 'window cleaning cost' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: infoPages });
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.faq_pages[0]!.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(1);
    expect(linkCount).toBeLessThanOrEqual(3);
  });

  it('never links a faq page to itself', () => {
    const faqPages = [
      makePage(
        '/faq/how-much-does-window-cleaning-cost',
        'faq',
        'How Much Does Window Cleaning Cost?',
        buildLargeBody(['window cleaning', 'gutter cleaning']),
        { primary_keyword: 'window cleaning cost' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: infoPages });
    const result = injectInternalLinks(bundle);
    expect(result.faq_pages[0]!.mdx).not.toContain('](/faq/how-much-does-window-cleaning-cost)');
  });

  it('preferentially targets the single most-related service or info page', () => {
    const faqPages = [
      makePage(
        '/faq/how-much-does-window-cleaning-cost',
        'faq',
        'How Much Does Window Cleaning Cost?',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'window cleaning cost' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: infoPages });
    const result = injectInternalLinks(bundle);
    const slugs = extractLinkSlugsInOrder(result.faq_pages[0]!.mdx);
    // Both /window-cleaning (service) and /pages/window-cleaning-tips (info)
    // share "window"+"cleaning" with the FAQ's primary_keyword; the service
    // was declared first in the combined candidate list so it wins ties.
    expect(slugs[0]).toBe('/window-cleaning');
    expect(slugs.indexOf('/window-cleaning')).toBeLessThan(slugs.indexOf('/gutter-cleaning'));
  });
});

describe('injectInternalLinks — info_pages', () => {
  const services = [
    makePage('/window-cleaning', 'service', 'Window Cleaning', buildServiceMdx('Window Cleaning'), {
      primary_keyword: 'window cleaning',
    }),
    makePage('/gutter-cleaning', 'service', 'Gutter Cleaning', buildServiceMdx('Gutter Cleaning'), {
      primary_keyword: 'gutter cleaning',
    }),
  ];

  it('caps links between 2 and 4', () => {
    const infoPages = [
      makePage(
        '/pages/window-cleaning-safety',
        'info',
        'Window Cleaning Safety Guide',
        buildLargeBody(['window cleaning', 'gutter cleaning']),
        { primary_keyword: 'window cleaning safety' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: [], info_pages: infoPages });
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.info_pages[0]!.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(2);
    expect(linkCount).toBeLessThanOrEqual(4);
  });

  it('never links an info page to itself', () => {
    const infoPages = [
      makePage(
        '/pages/window-cleaning-safety',
        'info',
        'Window Cleaning Safety Guide',
        buildLargeBody(['window cleaning', 'gutter cleaning']),
        { primary_keyword: 'window cleaning safety' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: [], info_pages: infoPages });
    const result = injectInternalLinks(bundle);
    expect(result.info_pages[0]!.mdx).not.toContain('](/pages/window-cleaning-safety)');
  });

  it('links related service pages plus 0-1 related blog/info page', () => {
    const infoPages = [
      makePage(
        '/pages/window-cleaning-safety',
        'info',
        'Window Cleaning Safety Guide',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'window cleaning safety' },
      ),
    ];
    const blogPosts = [
      makePage(
        '/blog/window-cleaning-frequency',
        'blog',
        'How Often Should You Clean Your Windows?',
        buildServiceMdx('Window Cleaning Frequency'),
        { primary_keyword: 'window cleaning frequency' },
      ),
    ];
    const bundle = makeBundle({
      services,
      service_areas: [],
      faq_pages: [],
      info_pages: infoPages,
      blog_posts: blogPosts,
    });
    const result = injectInternalLinks(bundle);
    const mdx = result.info_pages[0]!.mdx;
    const relatedBlogOrInfoLinks = [blogPosts[0]!.slug].filter((slug) => mdx.includes(`](${slug})`));
    // At most 1 related blog/info page is linked from an info page.
    expect(relatedBlogOrInfoLinks.length).toBeLessThanOrEqual(1);
    // The related service must still be linked (preferred target).
    expect(mdx).toContain('](/window-cleaning)');
  });
});

// ---------------------------------------------------------------------------
// Pillar/spoke architecture — SEO audit M3
// ---------------------------------------------------------------------------

describe('injectInternalLinks — pillar architecture (SEO audit M3)', () => {
  // Deliberately unrelated titles/keywords across services so relatedness
  // ranking alone (no pillar) would NOT naturally rank pressure-washing
  // first for a gutter-cleaning-cost FAQ — isolates the pillar-first effect
  // from the pre-existing keyword-overlap ranking.
  const services = [
    makePage('/pressure-washing', 'service', 'Pressure Washing', buildServiceMdx('Pressure Washing'), {
      primary_keyword: 'pressure washing',
      cluster_key: 'service-pressure-washing',
    }),
    makePage('/gutter-cleaning', 'service', 'Gutter Cleaning', buildServiceMdx('Gutter Cleaning'), {
      primary_keyword: 'gutter cleaning',
      cluster_key: 'service-gutter-cleaning',
    }),
  ];

  it('faq page with a pillar links the pillar service FIRST, ahead of relatedness ranking', () => {
    const faqPages = [
      makePage(
        '/faq/gutter-cleaning-cost',
        'faq',
        'How Much Does Gutter Cleaning Cost?',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'gutter cleaning cost', cluster_key: 'faq-gutter-cleaning-cost' },
      ),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'faq-gutter-cleaning-cost', pillar_key: 'service-gutter-cleaning' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    const result = injectInternalLinks(bundle, clusters);
    const slugs = extractLinkSlugsInOrder(result.faq_pages[0]!.mdx);
    expect(slugs[0]).toBe('/gutter-cleaning');
  });

  it('info page with a pillar links the pillar service FIRST', () => {
    const infoPages = [
      makePage(
        '/pages/gutter-cleaning-regulations',
        'info',
        'Local Gutter Cleaning Regulations',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'gutter cleaning regulations', cluster_key: 'info-gutter-regs' },
      ),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'info-gutter-regs', pillar_key: 'service-gutter-cleaning' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: [], info_pages: infoPages });
    const result = injectInternalLinks(bundle, clusters);
    const slugs = extractLinkSlugsInOrder(result.info_pages[0]!.mdx);
    expect(slugs[0]).toBe('/gutter-cleaning');
  });

  it('blog page with a pillar links the pillar service FIRST', () => {
    const blogPosts = [
      makePage(
        '/blog/gutter-cleaning-diy-vs-pro',
        'blog',
        'DIY vs Pro Gutter Cleaning',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'diy vs pro gutter cleaning', cluster_key: 'blog-gutter-diy-vs-pro' },
      ),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'blog-gutter-diy-vs-pro', pillar_key: 'service-gutter-cleaning' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: [], info_pages: [], blog_posts: blogPosts });
    const result = injectInternalLinks(bundle, clusters);
    const slugs = extractLinkSlugsInOrder(result.blog_posts[0]!.mdx);
    expect(slugs[0]).toBe('/gutter-cleaning');
  });

  it('service page gains a reciprocal link down to its spoke pages', () => {
    const faqPages = [
      makePage(
        '/faq/gutter-cleaning-cost',
        'faq',
        'How Much Does Gutter Cleaning Cost?',
        buildLargeBody(['pressure washing', 'gutter cleaning']),
        { primary_keyword: 'gutter cleaning cost', cluster_key: 'faq-gutter-cleaning-cost' },
      ),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'faq-gutter-cleaning-cost', pillar_key: 'service-gutter-cleaning' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    const result = injectInternalLinks(bundle, clusters);
    const gutterServicePage = result.services.find((s) => s.slug === '/gutter-cleaning')!;
    expect(gutterServicePage.mdx).toContain('](/faq/gutter-cleaning-cost)');
    // The unrelated pressure-washing service page should not gain a link to
    // a spoke that isn't assigned to it.
    const pressureServicePage = result.services.find((s) => s.slug === '/pressure-washing')!;
    expect(pressureServicePage.mdx).not.toContain('](/faq/gutter-cleaning-cost)');
  });

  it('service page caps reciprocal spoke links at 2, respecting the existing 4-8 cap', () => {
    const faqPages = [
      makePage('/faq/gutter-cleaning-cost', 'faq', 'How Much Does Gutter Cleaning Cost?', buildUnrelatedFillerMdx(), {
        primary_keyword: 'gutter cleaning cost',
        cluster_key: 'faq-gutter-cost',
      }),
      makePage('/faq/gutter-cleaning-frequency', 'faq', 'How Often Should Gutters Be Cleaned?', buildUnrelatedFillerMdx(), {
        primary_keyword: 'gutter cleaning frequency',
        cluster_key: 'faq-gutter-frequency',
      }),
      makePage('/faq/gutter-cleaning-diy', 'faq', 'Can I Clean My Own Gutters?', buildUnrelatedFillerMdx(), {
        primary_keyword: 'diy gutter cleaning',
        cluster_key: 'faq-gutter-diy',
      }),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'faq-gutter-cost', pillar_key: 'service-gutter-cleaning' },
      { cluster_key: 'faq-gutter-frequency', pillar_key: 'service-gutter-cleaning' },
      { cluster_key: 'faq-gutter-diy', pillar_key: 'service-gutter-cleaning' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    const result = injectInternalLinks(bundle, clusters);
    const gutterServicePage = result.services.find((s) => s.slug === '/gutter-cleaning')!;
    const linkedSpokeSlugs = faqPages
      .map((p) => p.slug)
      .filter((slug) => gutterServicePage.mdx.includes(`](${slug})`));
    expect(linkedSpokeSlugs.length).toBeLessThanOrEqual(2);
    const totalLinks = countLinks(gutterServicePage.mdx);
    expect(totalLinks).toBeLessThanOrEqual(8);
  });

  it('a page with no pillar (null pillar_key) falls back to the pre-existing relatedness-only behavior', () => {
    const faqPages = [
      makePage(
        '/faq/gutter-cleaning-cost',
        'faq',
        'How Much Does Gutter Cleaning Cost?',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'gutter cleaning cost', cluster_key: 'faq-gutter-cleaning-cost' },
      ),
    ];
    const clusters = [
      { cluster_key: 'service-pressure-washing', pillar_key: null },
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'faq-gutter-cleaning-cost', pillar_key: null },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    const withClusters = injectInternalLinks(bundle, clusters);
    const withoutClusters = injectInternalLinks(bundle);
    expect(withClusters.faq_pages[0]!.mdx).toBe(withoutClusters.faq_pages[0]!.mdx);
  });

  it('a page whose pillar_key references a dropped/unknown cluster falls back to relatedness ranking (no throw)', () => {
    const faqPages = [
      makePage(
        '/faq/gutter-cleaning-cost',
        'faq',
        'How Much Does Gutter Cleaning Cost?',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'gutter cleaning cost', cluster_key: 'faq-gutter-cleaning-cost' },
      ),
    ];
    // pillar_key references a service cluster that was never emitted.
    const clusters = [
      { cluster_key: 'service-gutter-cleaning', pillar_key: null },
      { cluster_key: 'faq-gutter-cleaning-cost', pillar_key: 'service-does-not-exist' },
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    expect(() => injectInternalLinks(bundle, clusters)).not.toThrow();
    const result = injectInternalLinks(bundle, clusters);
    const linkCount = countLinks(result.faq_pages[0]!.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(1);
    expect(linkCount).toBeLessThanOrEqual(3);
  });

  it('calling injectInternalLinks without a clusters argument preserves pre-pillar behavior', () => {
    const faqPages = [
      makePage(
        '/faq/gutter-cleaning-cost',
        'faq',
        'How Much Does Gutter Cleaning Cost?',
        buildUnrelatedFillerMdx(),
        { primary_keyword: 'gutter cleaning cost', cluster_key: 'faq-gutter-cleaning-cost' },
      ),
    ];
    const bundle = makeBundle({ services, service_areas: [], faq_pages: faqPages, info_pages: [] });
    expect(() => injectInternalLinks(bundle)).not.toThrow();
    const result = injectInternalLinks(bundle);
    const linkCount = countLinks(result.faq_pages[0]!.mdx);
    expect(linkCount).toBeGreaterThanOrEqual(1);
  });
});
