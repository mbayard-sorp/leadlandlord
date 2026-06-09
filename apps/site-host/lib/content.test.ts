import { describe, expect, it } from 'vitest';
import { pageHref } from './content';
import type { Page } from './content';

// pageHref is the single source of truth for internal links + sitemap URLs.
// The site runs trailingSlash:false, so every href MUST be canonical and
// NO-trailing-slash — otherwise Googlebot crawls 308/301 redirect variants
// (the exact failure seen in GSC: pages stuck "Discovered, never crawled").
function page(kind: string, slug: string): Page {
  return { kind, slug, title: 't', meta_description: 'd', mdx: '' } as Page;
}

describe('pageHref', () => {
  it('home → /', () => {
    expect(pageHref(page('home', '/'))).toBe('/');
  });

  it('service flattens any legacy /services/ prefix and trailing slash', () => {
    // Bundle/Sanity slugs appear in all these shapes in the wild.
    for (const slug of [
      'flat-roof-replacement',
      '/flat-roof-replacement',
      '/flat-roof-replacement/',
      '/services/flat-roof-replacement',
      '/services/flat-roof-replacement/',
    ]) {
      expect(pageHref(page('service', slug))).toBe('/flat-roof-replacement');
    }
  });

  it("service_area (underscore kind) keeps the /service-areas/ route prefix", () => {
    // Regression guard: bundle tags these `service_area`, not `service-area`.
    // A kind mismatch silently flattens them to /<city> → 404.
    for (const slug of ['dallas', '/dallas', '/service-areas/dallas', '/service-areas/dallas/']) {
      expect(pageHref(page('service_area', slug))).toBe('/service-areas/dallas');
    }
  });

  it('blog keeps the /blog/ prefix, no trailing slash', () => {
    expect(pageHref(page('blog', '/blog/how-much-does-it-cost/'))).toBe('/blog/how-much-does-it-cost');
    expect(pageHref(page('blog', 'how-much-does-it-cost'))).toBe('/blog/how-much-does-it-cost');
  });

  it('info maps to /pages/ route, no trailing slash', () => {
    expect(pageHref(page('info', '/pages/financing/'))).toBe('/pages/financing');
    expect(pageHref(page('info', 'financing'))).toBe('/pages/financing');
  });

  it('never emits a trailing slash for any kind', () => {
    const cases: Array<[string, string]> = [
      ['service', '/x/'],
      ['service_area', '/service-areas/x/'],
      ['blog', '/blog/x/'],
      ['info', '/pages/x/'],
    ];
    for (const [kind, slug] of cases) {
      expect(pageHref(page(kind, slug)).endsWith('/')).toBe(false);
    }
  });
});
