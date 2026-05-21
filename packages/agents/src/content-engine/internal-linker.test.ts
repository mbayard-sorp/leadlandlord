import { describe, expect, it } from 'vitest';
import { injectInternalLinks } from './internal-linker';
import type { ContentBundle } from '@leadlandlord/shared/types';

function makePage(slug: string, kind: string, title: string, mdx: string): ContentBundle['home'] {
  return {
    kind: kind as ContentBundle['home']['kind'],
    slug,
    title,
    meta_description: `${title} in test city`,
    mdx,
    targeted_keywords: [],
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
    home: makePage('/', 'home', 'Baton Rouge Cleaning Services', homeMdx),
    about: makePage('/about', 'about', 'About Us', 'We are a local cleaning company.'),
    contact: makePage('/contact', 'contact', 'Contact Us', 'Contact us for a free quote.'),
    services,
    service_areas: [],
    blog_posts: [
      makePage('/blog/how-often-clean-gutters', 'blog', 'How Often Should You Clean Your Gutters?', buildBlogMdx('gutter cleaning')),
    ],
    info_pages: [],
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
