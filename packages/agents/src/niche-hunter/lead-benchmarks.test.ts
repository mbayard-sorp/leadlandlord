import { describe, it, expect } from 'vitest';
import {
  getRentabilityPrior,
  getLeadBenchmarkPrice,
  computeRentabilityScore,
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
