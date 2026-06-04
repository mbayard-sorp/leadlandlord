import { describe, expect, it } from 'vitest';
import { canonicalPath } from './seo-meta';

describe('canonicalPath', () => {
  it('strips a trailing slash so canonical == the 200-serving URL', () => {
    // The site runs trailingSlash:false; "/services/x/" 308-redirects to
    // "/services/x". Canonical must point at the 200, not the redirect.
    expect(canonicalPath('/services/turf-install/')).toBe('/services/turf-install');
    expect(canonicalPath('/about/')).toBe('/about');
    expect(canonicalPath('/blog/why-mulch/')).toBe('/blog/why-mulch');
    expect(canonicalPath('/service-areas/henderson/')).toBe('/service-areas/henderson');
  });

  it('keeps the homepage as "/"', () => {
    expect(canonicalPath('/')).toBe('/');
  });

  it('is idempotent on already-clean paths', () => {
    expect(canonicalPath('/services/turf-install')).toBe('/services/turf-install');
    expect(canonicalPath('/contact')).toBe('/contact');
  });

  it('collapses multiple trailing slashes and normalizes a missing leading slash', () => {
    expect(canonicalPath('/pages/permits///')).toBe('/pages/permits');
    expect(canonicalPath('about/')).toBe('/about');
  });

  it('matches the sitemap/llms.txt canonicalization (no redirect mismatch)', () => {
    // These are the exact paths buildPageMetadata receives from the routes.
    const routePaths = ['/services/x/', '/service-areas/y/', '/blog/z/', '/pages/w/', '/about/', '/contact/'];
    for (const p of routePaths) {
      const c = canonicalPath(p);
      expect(c.endsWith('/')).toBe(false);
      expect(c.startsWith('/')).toBe(true);
    }
  });
});
