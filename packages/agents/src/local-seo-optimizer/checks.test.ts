import { describe, expect, it } from 'vitest';
import {
  aggregateLocalQueries,
  pickKeywordDrift,
  pickServiceAreaGaps,
  computeLocalSeoScore,
  extractCandidateCities,
  type GscRow,
} from './checks';

describe('aggregateLocalQueries', () => {
  it('impression-weights position across duplicate (query,page) rows', () => {
    const rows: GscRow[] = [
      { query: 'tree removal tucson', page: '/p', clicks: 0, impressions: 100, ctr: 0, position: 12 },
      { query: 'tree removal tucson', page: '/p', clicks: 0, impressions: 100, ctr: 0, position: 18 },
    ];
    const agg = aggregateLocalQueries(rows);
    expect(agg).toHaveLength(1);
    expect(agg[0]!.impressions).toBe(200);
    expect(agg[0]!.position).toBeCloseTo(15, 5);
  });
});

describe('pickKeywordDrift', () => {
  const cities = ['tucson', 'oro valley'];

  it('keeps only position 11..20 with impressions > 0', () => {
    const rows = aggregateLocalQueries([
      // page-2 drift (keep)
      { query: 'tree removal tucson', page: '/a', clicks: 1, impressions: 80, ctr: 0, position: 13 },
      // page-1 already (drop, < 11)
      { query: 'stump grinding tucson', page: '/b', clicks: 5, impressions: 200, ctr: 0, position: 6 },
      // page-3 (drop, > 20)
      { query: 'arborist tucson', page: '/c', clicks: 0, impressions: 40, ctr: 0, position: 24 },
      // boundary 11 (keep)
      { query: 'tree trimming tucson', page: '/d', clicks: 0, impressions: 10, ctr: 0, position: 11 },
      // boundary 20 (keep)
      { query: 'emergency tree tucson', page: '/e', clicks: 0, impressions: 5, ctr: 0, position: 20 },
      // zero impressions at valid position (drop)
      { query: 'tree service tucson', page: '/f', clicks: 0, impressions: 0, ctr: 0, position: 14 },
    ]);
    const drift = pickKeywordDrift(rows, cities);
    const queries = drift.map((d) => d.query).sort();
    expect(queries).toEqual([
      'emergency tree tucson',
      'tree removal tucson',
      'tree trimming tucson',
    ]);
  });

  it('filters out queries with no matching city when cities provided', () => {
    const rows = aggregateLocalQueries([
      { query: 'tree removal phoenix', page: '/a', clicks: 0, impressions: 50, ctr: 0, position: 14 },
      { query: 'tree removal tucson', page: '/b', clicks: 0, impressions: 50, ctr: 0, position: 14 },
    ]);
    const drift = pickKeywordDrift(rows, cities);
    expect(drift.map((d) => d.query)).toEqual(['tree removal tucson']);
  });

  it('sorts by impressions desc', () => {
    const rows = aggregateLocalQueries([
      { query: 'a tucson', page: '/a', clicks: 0, impressions: 30, ctr: 0, position: 15 },
      { query: 'b tucson', page: '/b', clicks: 0, impressions: 90, ctr: 0, position: 15 },
    ]);
    const drift = pickKeywordDrift(rows, cities);
    expect(drift.map((d) => d.impressions)).toEqual([90, 30]);
  });
});

describe('pickServiceAreaGaps', () => {
  it('flags a high-impression city with nothing ranking on page 1-2', () => {
    const rows = aggregateLocalQueries([
      // marana: lots of demand, best position 27 → gap
      { query: 'tree removal marana', page: '/home', clicks: 0, impressions: 120, ctr: 0, position: 27 },
      { query: 'stump grinding marana', page: '/home', clicks: 0, impressions: 60, ctr: 0, position: 33 },
      // tucson: well covered, ranks at 4 → not a gap
      { query: 'tree removal tucson', page: '/tucson', clicks: 10, impressions: 300, ctr: 0, position: 4 },
    ]);
    const gaps = pickServiceAreaGaps(rows, ['marana', 'tucson']);
    expect(gaps.map((g) => g.city.toLowerCase())).toEqual(['marana']);
    expect(gaps[0]!.impressions).toBe(180);
    expect(gaps[0]!.bestPosition).toBe(27);
  });

  it('ignores cities below the impressions floor', () => {
    const rows = aggregateLocalQueries([
      { query: 'tree removal vail', page: '/home', clicks: 0, impressions: 5, ctr: 0, position: 40 },
    ]);
    const gaps = pickServiceAreaGaps(rows, ['vail'], { minImpressions: 30 });
    expect(gaps).toHaveLength(0);
  });

  it('does not flag a city already ranking on page 1', () => {
    const rows = aggregateLocalQueries([
      { query: 'tree removal sahuarita', page: '/sahuarita', clicks: 8, impressions: 200, ctr: 0, position: 7 },
    ]);
    const gaps = pickServiceAreaGaps(rows, ['sahuarita']);
    expect(gaps).toHaveLength(0);
  });

  it('sorts gaps by impressions desc', () => {
    const rows = aggregateLocalQueries([
      { query: 'svc marana', page: '/h', clicks: 0, impressions: 50, ctr: 0, position: 25 },
      { query: 'svc oro valley', page: '/h', clicks: 0, impressions: 150, ctr: 0, position: 25 },
    ]);
    const gaps = pickServiceAreaGaps(rows, ['marana', 'oro valley']);
    expect(gaps.map((g) => g.city.toLowerCase())).toEqual(['oro valley', 'marana']);
  });
});

describe('computeLocalSeoScore', () => {
  it('equal-weights the five subscores and clamps', () => {
    expect(
      computeLocalSeoScore({
        serviceAreaCoverage: 100,
        keywordDrift: 100,
        localSchema: 100,
        internalLinkLocality: 100,
        trustFreshness: 100,
      }),
    ).toBe(100);
    expect(
      computeLocalSeoScore({
        serviceAreaCoverage: 0,
        keywordDrift: 50,
        localSchema: 100,
        internalLinkLocality: 50,
        trustFreshness: 0,
      }),
    ).toBe(40);
  });

  it('clamps out-of-range / non-finite subscores', () => {
    expect(
      computeLocalSeoScore({
        serviceAreaCoverage: 200,
        keywordDrift: -50,
        localSchema: Number.NaN,
        internalLinkLocality: 100,
        trustFreshness: 100,
      }),
    ).toBe(60); // (clamp200=100 + clamp(-50)=0 + NaN=0 + 100 + 100) / 5
  });
});

describe('extractCandidateCities', () => {
  it('pulls trailing tokens as candidate city names', () => {
    const cities = extractCandidateCities([
      { query: 'tree removal tucson' },
      { query: 'stump grinding oro valley' },
    ]);
    expect(cities).toContain('tucson');
    expect(cities).toContain('oro valley');
  });
});
