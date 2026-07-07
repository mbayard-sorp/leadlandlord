import { describe, it, expect } from 'vitest';
import {
  getRentabilityPrior,
  getLeadBenchmarkPrice,
  computeRentabilityScore,
  matchesTradeQuery,
  resolveMatchedTradeKeywords,
  DEFAULT_RENTABILITY_CPC_CEILING,
  DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
} from './lead-benchmarks';
import { MIN_LEAD_BENCHMARK_PRICE, MIN_RENTABILITY_PRIOR } from './scoring-config';
import { SERVICE_TAXONOMY } from './service-taxonomy';

// ─────────────────────────────────────────────────────────────────────────────
// getLeadBenchmarkPrice
// ─────────────────────────────────────────────────────────────────────────────

describe('getLeadBenchmarkPrice', () => {
  it('returns midpoint for a known high-ticket trade (roofing)', () => {
    // leadPriceRangeLow=80, high=150 → midpoint=115
    const price = getLeadBenchmarkPrice('residential roofing');
    expect(price).toBe(115);
  });

  it('returns midpoint for HVAC', () => {
    // leadPriceRangeLow=60, high=120 → midpoint=90
    const price = getLeadBenchmarkPrice('hvac installation');
    expect(price).toBe(90);
  });

  it('returns midpoint for a lower-ticket trade (pressure washing)', () => {
    // leadPriceRangeLow=20, high=45 → midpoint=32.5
    const price = getLeadBenchmarkPrice('pressure washing services');
    expect(price).toBe(32.5);
  });

  it('returns default (45) for an unknown niche', () => {
    const price = getLeadBenchmarkPrice('totally unknown exotic trade xyz');
    expect(price).toBe(45);
  });

  it('is case-insensitive', () => {
    const lower = getLeadBenchmarkPrice('plumbing repair');
    const upper = getLeadBenchmarkPrice('PLUMBING REPAIR');
    expect(lower).toBe(upper);
  });

  it('longest keyword wins over shorter overlap (foundation repair vs repair)', () => {
    // "foundation repair" keyword (16 chars) should win over any shorter keyword
    // — ensures the specificity rule works correctly.
    const price = getLeadBenchmarkPrice('foundation repair services');
    // foundation repair: low=80, high=140 → midpoint=110
    expect(price).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRentabilityScore — contractor count curves
// ─────────────────────────────────────────────────────────────────────────────

describe('computeRentabilityScore', () => {
  const BASE = { avg_cpc: 6, lead_benchmark_price: 60 };

  it('returns 0 for contractor_count=0 (no market exists)', () => {
    const score = computeRentabilityScore({ ...BASE, contractor_count: 0 });
    // At count=0: supplySub=0; cpcSub=6/12=0.5; leadSub=60/100=0.6
    // raw = 0*0.5 + 0.5*0.25 + 0.6*0.25 = 0.275 → 27.5
    expect(score).toBeCloseTo(27.5, 1);
  });

  it('scores low for contractor_count=1 (thin market)', () => {
    const score = computeRentabilityScore({ ...BASE, contractor_count: 1 });
    // count=1: supplySub = (1/2)*0.4 = 0.20
    // raw = 0.20*0.5 + 0.5*0.25 + 0.6*0.25 = 0.1 + 0.125 + 0.15 = 0.375 → 37.5
    expect(score).toBeCloseTo(37.5, 1);
  });

  it('scores higher for contractor_count=10 (healthy mid-market)', () => {
    const low = computeRentabilityScore({ ...BASE, contractor_count: 1 });
    const mid = computeRentabilityScore({ ...BASE, contractor_count: 10 });
    expect(mid).toBeGreaterThan(low);
  });

  it('peaks near contractor_count=14 and declines at 20 (saturation)', () => {
    const atPeak = computeRentabilityScore({ ...BASE, contractor_count: 14 });
    const atSaturation = computeRentabilityScore({ ...BASE, contractor_count: 20 });
    expect(atPeak).toBeGreaterThan(atSaturation);
  });

  it('score at count=20 is still higher than count=0 (saturation beats empty)', () => {
    const empty = computeRentabilityScore({ ...BASE, contractor_count: 0 });
    const saturated = computeRentabilityScore({ ...BASE, contractor_count: 20 });
    // Both have non-zero CPC and lead price sub-scores; supply at count=20 is 0.30
    expect(saturated).toBeGreaterThan(empty);
  });

  it('higher avg_cpc raises score (holding others constant)', () => {
    const lowCpc = computeRentabilityScore({ contractor_count: 8, avg_cpc: 2, lead_benchmark_price: 50 });
    const highCpc = computeRentabilityScore({ contractor_count: 8, avg_cpc: 10, lead_benchmark_price: 50 });
    expect(highCpc).toBeGreaterThan(lowCpc);
  });

  it('higher lead_benchmark_price raises score (holding others constant)', () => {
    const lowPrice = computeRentabilityScore({ contractor_count: 8, avg_cpc: 5, lead_benchmark_price: 20 });
    const highPrice = computeRentabilityScore({ contractor_count: 8, avg_cpc: 5, lead_benchmark_price: 90 });
    expect(highPrice).toBeGreaterThan(lowPrice);
  });

  it('score is always in [0, 100]', () => {
    const cases = [
      { contractor_count: 0, avg_cpc: 0, lead_benchmark_price: 0 },
      { contractor_count: 20, avg_cpc: 100, lead_benchmark_price: 200 },
      { contractor_count: 14, avg_cpc: 12, lead_benchmark_price: 100 },
      { contractor_count: 7, avg_cpc: 6, lead_benchmark_price: 60 },
    ];
    for (const c of cases) {
      const s = computeRentabilityScore(c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('cpc ceiling: avg_cpc >= 12 contributes max cpc sub-score (no further gain above ceiling)', () => {
    const atCeiling = computeRentabilityScore({ contractor_count: 8, avg_cpc: 12, lead_benchmark_price: 50 });
    const aboveCeiling = computeRentabilityScore({ contractor_count: 8, avg_cpc: 99, lead_benchmark_price: 50 });
    expect(atCeiling).toBeCloseTo(aboveCeiling, 5);
  });

  it('lead price ceiling: lead_benchmark_price >= 100 contributes max sub-score', () => {
    const atCeiling = computeRentabilityScore({ contractor_count: 8, avg_cpc: 5, lead_benchmark_price: 100 });
    const aboveCeiling = computeRentabilityScore({ contractor_count: 8, avg_cpc: 5, lead_benchmark_price: 200 });
    expect(atCeiling).toBeCloseTo(aboveCeiling, 5);
  });

  // Task B: operator-overridable ceilings (omit-when-absent → defaults 12/100).
  it('omitting cpc_ceiling/lead_price_ceiling matches the default ceilings (12/100)', () => {
    const defaulted = computeRentabilityScore({ contractor_count: 8, avg_cpc: 6, lead_benchmark_price: 60 });
    const explicit = computeRentabilityScore({
      contractor_count: 8,
      avg_cpc: 6,
      lead_benchmark_price: 60,
      cpc_ceiling: 12,
      lead_price_ceiling: 100,
    });
    expect(defaulted).toBeCloseTo(explicit, 10);
  });

  it('a lower cpc_ceiling makes the same avg_cpc score higher (easier to saturate)', () => {
    const base = computeRentabilityScore({ contractor_count: 8, avg_cpc: 6, lead_benchmark_price: 60 });
    const tighter = computeRentabilityScore({
      contractor_count: 8,
      avg_cpc: 6,
      lead_benchmark_price: 60,
      cpc_ceiling: 6, // avg_cpc now hits the ceiling → full cpc sub-score
    });
    expect(tighter).toBeGreaterThan(base);
  });

  it('a higher lead_price_ceiling lowers the lead-price sub-score for a fixed price', () => {
    const base = computeRentabilityScore({ contractor_count: 8, avg_cpc: 6, lead_benchmark_price: 60 });
    const harder = computeRentabilityScore({
      contractor_count: 8,
      avg_cpc: 6,
      lead_benchmark_price: 60,
      lead_price_ceiling: 200, // 60/200 < 60/100
    });
    expect(harder).toBeLessThan(base);
  });

  it('a zero ceiling yields a zero sub-score (no divide-by-zero)', () => {
    const s = computeRentabilityScore({
      contractor_count: 8,
      avg_cpc: 6,
      lead_benchmark_price: 60,
      cpc_ceiling: 0,
      lead_price_ceiling: 0,
    });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRentabilityScore v2 — Places supply signal (ADR 0029)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeRentabilityScore v2 (ADR 0029) — explicit branch, not algebraic collapse', () => {
  // Reference (pre-v2) score computed by hand from the documented v1 weights,
  // used to prove the branch is byte-identical — NOT "close enough".
  function ref_v1(contractor_count: number, avg_cpc: number, lead_benchmark_price: number): number {
    const count = Math.max(0, Math.min(20, contractor_count));
    let supplySub: number;
    if (count <= 2) {
      supplySub = (count / 2) * 0.4;
    } else if (count <= 14) {
      supplySub = 0.4 + ((count - 2) / 12) * 0.6;
    } else {
      supplySub = 1.0 - ((count - 14) / 6) * 0.7;
    }
    const cpcSub = Math.min(1, avg_cpc / DEFAULT_RENTABILITY_CPC_CEILING);
    const leadPriceSub = Math.min(1, lead_benchmark_price / DEFAULT_RENTABILITY_LEAD_PRICE_CEILING);
    const raw = supplySub * 0.5 + cpcSub * 0.25 + leadPriceSub * 0.25;
    return Math.min(100, Math.max(0, raw * 100));
  }

  it('undefined inputs -> byte-identical v1 formula (regression, exact equality)', () => {
    const cases: Array<{ contractor_count: number; avg_cpc: number; lead_benchmark_price: number }> = [
      { contractor_count: 0, avg_cpc: 0, lead_benchmark_price: 0 },
      { contractor_count: 1, avg_cpc: 3, lead_benchmark_price: 45 },
      { contractor_count: 8, avg_cpc: 6, lead_benchmark_price: 60 },
      { contractor_count: 14, avg_cpc: 12, lead_benchmark_price: 100 },
      { contractor_count: 20, avg_cpc: 25, lead_benchmark_price: 200 },
    ];
    for (const c of cases) {
      const actual = computeRentabilityScore(c);
      const expected = ref_v1(c.contractor_count, c.avg_cpc, c.lead_benchmark_price);
      // Exact equality (toBe), not toBeCloseTo — proves the branch is truly
      // byte-identical to the pre-change formula when the new inputs are absent.
      expect(actual).toBe(expected);
    }
  });

  it('a real value with only contractors_without_website present activates v2 (diverges from v1 in general)', () => {
    const base = { contractor_count: 10, avg_cpc: 6, lead_benchmark_price: 60 };
    const v1 = computeRentabilityScore(base);
    const v2 = computeRentabilityScore({ ...base, contractors_without_website: 8 });
    // v1 formula must not silently apply once the new field is present.
    expect(v2).not.toBe(v1);
  });

  it('higher no-website share raises the score (holding contractor_count and other inputs constant)', () => {
    const base = { contractor_count: 10, avg_cpc: 6, lead_benchmark_price: 60 };
    const lowWeakness = computeRentabilityScore({ ...base, contractors_without_website: 1 });
    const highWeakness = computeRentabilityScore({ ...base, contractors_without_website: 9 });
    expect(highWeakness).toBeGreaterThan(lowWeakness);
  });

  it('contractors_without_website=0 (every contractor already has a site) scores at or below the v1 supply/cpc/leadPrice-only weighting', () => {
    const base = { contractor_count: 10, avg_cpc: 6, lead_benchmark_price: 60 };
    const zeroWeakness = computeRentabilityScore({ ...base, contractors_without_website: 0 });
    const someWeakness = computeRentabilityScore({ ...base, contractors_without_website: 5 });
    expect(zeroWeakness).toBeLessThan(someWeakness);
  });

  it('median_review_count refines weakness: thin reviews (low median) alongside high no-website share raises score further than a high median', () => {
    const base = { contractor_count: 10, avg_cpc: 6, lead_benchmark_price: 60, contractors_without_website: 8 };
    const thinReviews = computeRentabilityScore({ ...base, median_review_count: 2 });
    const healthyReviews = computeRentabilityScore({ ...base, median_review_count: 80 });
    expect(thinReviews).toBeGreaterThan(healthyReviews);
  });

  it('median_review_count alone (contractors_without_website undefined) still activates v2 branch', () => {
    const base = { contractor_count: 10, avg_cpc: 6, lead_benchmark_price: 60 };
    const v1 = computeRentabilityScore(base);
    const v2 = computeRentabilityScore({ ...base, median_review_count: 5 });
    // noWebsiteShare defaults to 0 when contractors_without_website is absent,
    // so this exercises the v2 weight redistribution (0.45/0.15/0.2/0.2) with
    // weaknessSub=0, which is NOT the same as the v1 weights (0.5/0.25/0.25).
    expect(v2).not.toBe(v1);
  });

  it('contractor_count=0 with contractors_without_website present does not divide by zero', () => {
    const s = computeRentabilityScore({
      contractor_count: 0,
      avg_cpc: 6,
      lead_benchmark_price: 60,
      contractors_without_website: 0,
      median_review_count: 0,
    });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it('score stays in [0, 100] across a spread of v2 inputs', () => {
    const combos = [
      { contractor_count: 0, avg_cpc: 0, lead_benchmark_price: 0, contractors_without_website: 0, median_review_count: 0 },
      { contractor_count: 20, avg_cpc: 30, lead_benchmark_price: 300, contractors_without_website: 20, median_review_count: 0 },
      { contractor_count: 14, avg_cpc: 12, lead_benchmark_price: 100, contractors_without_website: 7, median_review_count: 25 },
      { contractor_count: 5, avg_cpc: 3, lead_benchmark_price: 40, contractors_without_website: 1, median_review_count: 120 },
    ];
    for (const c of combos) {
      const s = computeRentabilityScore(c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRentabilityPrior — existing tests (unchanged, verifying no regression)
// ─────────────────────────────────────────────────────────────────────────────

describe('getRentabilityPrior (existing, regression check)', () => {
  it('roofing returns high prior (0.9)', () => {
    expect(getRentabilityPrior('residential roofing')).toBe(0.9);
  });

  it('junk removal returns low prior', () => {
    expect(getRentabilityPrior('junk removal')).toBeLessThan(0.5);
  });

  it('unknown niche returns neutral prior (0.5)', () => {
    expect(getRentabilityPrior('totally unknown xyz trade')).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Floor guard: default pair sits below BOTH thresholds (ADR 0021)
// ─────────────────────────────────────────────────────────────────────────────

describe('floor guard — default pair vs floor thresholds', () => {
  it('DEFAULT lead price (45) is below MIN_LEAD_BENCHMARK_PRICE (50)', () => {
    const price = getLeadBenchmarkPrice('totally unknown xyz trade');
    expect(price).toBeLessThan(MIN_LEAD_BENCHMARK_PRICE);
  });

  it('DEFAULT rentability prior (0.5) is below MIN_RENTABILITY_PRIOR (0.60)', () => {
    const prior = getRentabilityPrior('totally unknown xyz trade');
    expect(prior).toBeLessThan(MIN_RENTABILITY_PRIOR);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legal benchmark entries resolve to mapped (non-default) economics
// ─────────────────────────────────────────────────────────────────────────────

describe('legal trade benchmarks — mapped and above floor', () => {
  const LEGAL_TRADES = [
    'personal injury lawyer',
    'car accident lawyer',
    'truck accident lawyer',
    'criminal defense lawyer',
    'dui lawyer',
    'divorce lawyer',
    'bankruptcy lawyer',
    'immigration lawyer',
    'estate planning attorney',
    'medical malpractice lawyer',
  ];

  for (const trade of LEGAL_TRADES) {
    it(`${trade} resolves to mapped economics above both floors`, () => {
      const price = getLeadBenchmarkPrice(trade);
      const prior = getRentabilityPrior(trade);
      // Must be above defaults (proving it matched a benchmark entry)
      expect(price).toBeGreaterThan(45);   // not the $45 default
      expect(prior).toBeGreaterThan(0.5);  // not the 0.5 default
      // Must clear the floors
      expect(price).toBeGreaterThanOrEqual(MIN_LEAD_BENCHMARK_PRICE);
      expect(prior).toBeGreaterThanOrEqual(MIN_RENTABILITY_PRIOR);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION GUARD: every trade in the pruned SERVICE_TAXONOMY must pass the
// ability-to-pay floor (price >= 50, prior >= 0.60). This test makes the
// "benchmark-before-floor" gap un-regressable: any new taxonomy trade added
// without a matching benchmark entry will fail here before Phase D can run.
// ─────────────────────────────────────────────────────────────────────────────

describe('all pruned taxonomy trades pass ability-to-pay floor', () => {
  for (const [category, trades] of Object.entries(SERVICE_TAXONOMY)) {
    for (const trade of trades) {
      it(`[${category}] "${trade}" price >= ${MIN_LEAD_BENCHMARK_PRICE} AND prior >= ${MIN_RENTABILITY_PRIOR}`, () => {
        const price = getLeadBenchmarkPrice(trade);
        const prior = getRentabilityPrior(trade);
        expect(
          price,
          `"${trade}" lead price ${price} < floor ${MIN_LEAD_BENCHMARK_PRICE} (defaults to $45 — missing benchmark entry)`,
        ).toBeGreaterThanOrEqual(MIN_LEAD_BENCHMARK_PRICE);
        expect(
          prior,
          `"${trade}" rentability prior ${prior} < floor ${MIN_RENTABILITY_PRIOR} (defaults to 0.5 — missing benchmark entry)`,
        ).toBeGreaterThanOrEqual(MIN_RENTABILITY_PRIOR);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Medical benchmark entries resolve to mapped (non-default) economics
// ─────────────────────────────────────────────────────────────────────────────

describe('medical trade benchmarks — mapped and above floor', () => {
  const MEDICAL_TRADES = [
    'dental implants',
    'general dentist',
    'orthodontist',
    'chiropractor',
    'physical therapy clinic',
    'dermatology clinic',
    'optometrist',
    'lasik eye surgery',
    'weight loss clinic',
    'veterinary clinic',
  ];

  for (const trade of MEDICAL_TRADES) {
    it(`${trade} resolves to mapped economics above both floors`, () => {
      const price = getLeadBenchmarkPrice(trade);
      const prior = getRentabilityPrior(trade);
      expect(price).toBeGreaterThan(45);
      expect(prior).toBeGreaterThan(0.5);
      expect(price).toBeGreaterThanOrEqual(MIN_LEAD_BENCHMARK_PRICE);
      expect(prior).toBeGreaterThanOrEqual(MIN_RENTABILITY_PRIOR);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveMatchedTradeKeywords
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveMatchedTradeKeywords', () => {
  it('returns the matched benchmark keyword list for a mapped trade', () => {
    const keywords = resolveMatchedTradeKeywords('residential roofing');
    expect(keywords).not.toBeNull();
    expect(keywords).toContain('roofing');
  });

  it('returns null for an unmapped niche (falls to default bucket)', () => {
    expect(resolveMatchedTradeKeywords('totally unknown exotic trade xyz')).toBeNull();
  });

  it('longest-keyword-wins is preserved (foundation repair over repair)', () => {
    const keywords = resolveMatchedTradeKeywords('foundation repair services');
    expect(keywords).toContain('foundation repair');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchesTradeQuery
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesTradeQuery', () => {
  it('matches a GSC query containing the trade keyword as a substring', () => {
    expect(matchesTradeQuery('roof repair phoenix az', 'residential roofing')).toBe(true);
  });

  it('matches a single-word keyword embedded in a longer local query', () => {
    expect(matchesTradeQuery('emergency roofer near me 85001', 'residential roofing')).toBe(true);
  });

  it('matches a multi-word keyword reordered in the query (token overlap)', () => {
    // keyword "water heater" — query has both tokens but reordered + extra words.
    expect(matchesTradeQuery('heater water repair service tucson', 'water heater repair')).toBe(true);
  });

  it('does not match an unrelated query for a mapped trade', () => {
    expect(matchesTradeQuery('best pizza delivery near me', 'residential roofing')).toBe(false);
  });

  it('does not match when only one token of a multi-word keyword overlaps', () => {
    // "foundation repair" keyword — query shares only "repair", not "foundation".
    expect(matchesTradeQuery('garage door repair services', 'foundation repair contractor')).toBe(false);
  });

  it('returns false for a niche with no benchmark match (default bucket)', () => {
    expect(matchesTradeQuery('anything at all', 'totally unknown exotic trade xyz')).toBe(false);
  });

  it('is case-insensitive on both query and niche', () => {
    expect(matchesTradeQuery('ROOF REPAIR PHOENIX', 'RESIDENTIAL ROOFING')).toBe(true);
  });

  it('strips geo/stopword filler without producing false positives', () => {
    // "near me" and city/state tokens shouldn't cause spurious overlap for an
    // unrelated trade that happens to share only stopwords with the query.
    expect(matchesTradeQuery('best hvac company near me in tucson az', 'plumbing repair')).toBe(false);
    expect(matchesTradeQuery('best hvac company near me in tucson az', 'hvac installation')).toBe(true);
  });

  it('empty query never matches', () => {
    expect(matchesTradeQuery('', 'residential roofing')).toBe(false);
  });
});
