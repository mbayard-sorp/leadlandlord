import { describe, it, expect } from 'vitest';
import { qualifyLeadPlaces, type Place } from './index';

function place(p: Partial<Place>): Place {
  return { id: p.id ?? 'x', types: p.types ?? [], ...p } as Place;
}

describe('qualifyLeadPlaces', () => {
  const sample: Place[] = [
    place({ id: 'no-site-good', rating: 4.6, userRatingCount: 40 }), // keep
    place({ id: 'has-site', websiteUri: 'https://x.com', rating: 4.9, userRatingCount: 99 }), // drop: has website
    place({ id: 'low-rating', rating: 3.5, userRatingCount: 40 }), // drop: rating
    place({ id: 'few-reviews', rating: 4.8, userRatingCount: 3 }), // drop: reviews
    place({ id: 'no-rating', userRatingCount: 40 }), // drop: rating undefined < 4.0
  ];

  it('keeps only no-website, strong-review businesses (defaults 4.0 / 10)', () => {
    const out = qualifyLeadPlaces(sample);
    expect(out.map((p) => p.id)).toEqual(['no-site-good']);
  });

  it('respects custom thresholds', () => {
    const out = qualifyLeadPlaces(sample, { ratingMin: 3.0, reviewsMin: 3 });
    expect(out.map((p) => p.id).sort()).toEqual(['few-reviews', 'low-rating', 'no-site-good']);
  });

  it('drops everything with a website regardless of rating', () => {
    const all = [
      place({ id: 'a', websiteUri: 'https://a.com', rating: 5, userRatingCount: 500 }),
      place({ id: 'b', websiteUri: 'http://b.io', rating: 4.9, userRatingCount: 200 }),
    ];
    expect(qualifyLeadPlaces(all)).toEqual([]);
  });
});
