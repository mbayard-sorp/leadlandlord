import { describe, it, expect } from 'vitest';
import { sortLeadPlaces, type Place } from './index';

function place(p: Partial<Place>): Place {
  return { id: p.id ?? 'x', types: p.types ?? [], ...p } as Place;
}

describe('sortLeadPlaces', () => {
  it('puts no-website businesses first, then the rest', () => {
    const out = sortLeadPlaces([
      place({ id: 'has-site', websiteUri: 'https://x.com', rating: 4.9, userRatingCount: 99 }),
      place({ id: 'no-site', rating: 4.0, userRatingCount: 10 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['no-site', 'has-site']);
  });

  it('does NOT drop website-having businesses (sort, not filter)', () => {
    const input = [
      place({ id: 'a', websiteUri: 'https://a.com' }),
      place({ id: 'b' }),
      place({ id: 'c', websiteUri: 'https://c.com' }),
    ];
    expect(sortLeadPlaces(input)).toHaveLength(3);
  });

  it('within a group, ranks by review count then rating', () => {
    const out = sortLeadPlaces([
      place({ id: 'few', userRatingCount: 5, rating: 5 }),
      place({ id: 'many', userRatingCount: 200, rating: 4.2 }),
      place({ id: 'mid', userRatingCount: 50, rating: 4.9 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(['many', 'mid', 'few']);
  });

  it('ranks all no-website ahead of any with-website regardless of reviews', () => {
    const out = sortLeadPlaces([
      place({ id: 'site-popular', websiteUri: 'https://x.com', userRatingCount: 500 }),
      place({ id: 'nosite-quiet', userRatingCount: 3 }),
    ]);
    expect(out[0]!.id).toBe('nosite-quiet');
  });
});
