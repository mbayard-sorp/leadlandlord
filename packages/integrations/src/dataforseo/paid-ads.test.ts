import { describe, it, expect } from 'vitest';
import { paidAdsCacheKey } from './index';
import { stableKey } from './cache';

describe('paidAdsCacheKey', () => {
  it('keeps the legacy national key shape when no location is given', () => {
    // Existing cache entries were keyed stableKey([language_code, location_code, keyword]).
    // City-scoping must NOT invalidate them.
    const legacy = stableKey(['en', 2840, 'tree removal tucson']);
    expect(paidAdsCacheKey({ keyword: 'tree removal tucson' })).toBe(legacy);
    expect(
      paidAdsCacheKey({ keyword: 'Tree Removal Tucson', language_code: 'en', location_code: 2840 }),
    ).toBe(legacy);
  });

  it('produces a distinct key when a location string is supplied', () => {
    const national = paidAdsCacheKey({ keyword: 'tree removal tucson' });
    const city = paidAdsCacheKey({
      keyword: 'tree removal tucson',
      location: 'Tucson,Arizona,United States',
    });
    expect(city).not.toBe(national);
    expect(city).toBe(stableKey(['en', 'Tucson,Arizona,United States', 'tree removal tucson']));
  });

  it('different cities yield different keys', () => {
    const a = paidAdsCacheKey({ keyword: 'plumber', location: 'Tucson,Arizona,United States' });
    const b = paidAdsCacheKey({ keyword: 'plumber', location: 'Mesa,Arizona,United States' });
    expect(a).not.toBe(b);
  });
});
