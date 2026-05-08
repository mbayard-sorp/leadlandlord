import { describe, it, expect } from 'vitest';
import {
  MaintenanceInput,
  MaintenanceOutput,
  classifySslExpiry,
  shouldSkipSslCheck,
  classifyDomainExpiry,
  classifyTrafficDrop,
  extractLinks,
  resolveLink,
} from './index';

describe('maintenance schema', () => {
  it('accepts empty input (run-all)', () => {
    expect(MaintenanceInput.parse({}).siteId).toBeUndefined();
  });
  it('accepts a uuid siteId', () => {
    const parsed = MaintenanceInput.parse({ siteId: '11111111-1111-1111-1111-111111111111' });
    expect(parsed.siteId).toBe('11111111-1111-1111-1111-111111111111');
  });
  it('rejects non-uuid siteId', () => {
    expect(() => MaintenanceInput.parse({ siteId: 'not-a-uuid' })).toThrow();
  });
  it('validates output', () => {
    expect(() =>
      MaintenanceOutput.parse({ sitesChecked: 1, findingsCount: 0, autoFixedCount: 0 }),
    ).not.toThrow();
  });
});

describe('classifySslExpiry', () => {
  it('returns critical when <14 days', () => {
    expect(classifySslExpiry(0)).toBe('critical');
    expect(classifySslExpiry(13)).toBe('critical');
  });
  it('returns warning between 14 and 30 days', () => {
    expect(classifySslExpiry(14)).toBe('warning');
    expect(classifySslExpiry(29)).toBe('warning');
  });
  it('returns null when >=30 days', () => {
    expect(classifySslExpiry(30)).toBeNull();
    expect(classifySslExpiry(365)).toBeNull();
  });
});

describe('shouldSkipSslCheck', () => {
  it('skips null and vercel.app domains', () => {
    expect(shouldSkipSslCheck(null)).toBe(true);
    expect(shouldSkipSslCheck('foo.vercel.app')).toBe(true);
    expect(shouldSkipSslCheck('FOO.VERCEL.APP')).toBe(true);
  });
  it('does not skip real domains', () => {
    expect(shouldSkipSslCheck('example.com')).toBe(false);
  });
});

describe('classifyDomainExpiry', () => {
  it('flags critical when expired', () => {
    expect(classifyDomainExpiry(-1)).toBe('critical');
  });
  it('flags warning under 30 days', () => {
    expect(classifyDomainExpiry(15)).toBe('warning');
  });
  it('returns null when plenty of runway', () => {
    expect(classifyDomainExpiry(90)).toBeNull();
  });
});

describe('classifyTrafficDrop', () => {
  it('ignores low-traffic prior weeks', () => {
    expect(classifyTrafficDrop(0, 10).drop).toBe(false);
  });
  it('flags > 50% drop on a meaningful baseline', () => {
    const r = classifyTrafficDrop(40, 100);
    expect(r.drop).toBe(true);
    expect(r.ratio).toBe(0.4);
  });
  it('does not flag stable traffic', () => {
    expect(classifyTrafficDrop(95, 100).drop).toBe(false);
  });
});

describe('extractLinks', () => {
  it('extracts markdown and html links', () => {
    const body = `
      See [home](/) and [about](https://example.com/about).
      <a href="/contact">contact</a>
      <a href='https://x.com'>x</a>
    `;
    const links = extractLinks(body);
    expect(links).toEqual(expect.arrayContaining(['/', 'https://example.com/about', '/contact', 'https://x.com']));
  });
});

describe('resolveLink', () => {
  it('resolves relative to site domain', () => {
    expect(resolveLink('/about', 'example.com')).toBe('https://example.com/about');
    expect(resolveLink('about', 'example.com')).toBe('https://example.com/about');
  });
  it('returns null for mailto/tel/anchor', () => {
    expect(resolveLink('mailto:x@y', 'example.com')).toBeNull();
    expect(resolveLink('tel:+1', 'example.com')).toBeNull();
    expect(resolveLink('#top', 'example.com')).toBeNull();
  });
  it('passes through absolute http(s)', () => {
    expect(resolveLink('https://x.com/y', 'example.com')).toBe('https://x.com/y');
  });
  it('returns null when domain missing for relative link', () => {
    expect(resolveLink('/x', null)).toBeNull();
  });
});
