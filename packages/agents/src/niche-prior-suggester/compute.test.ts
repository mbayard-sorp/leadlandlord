import { describe, it, expect } from 'vitest';
import {
  shrinkageSuggest,
  poolByTradeAndState,
  buildSuggestions,
  SHRINKAGE_K,
  MIN_TRADE_SAMPLE,
  MIN_TRADE_STATE_SAMPLE,
  type OutcomeRow,
} from './compute';

describe('shrinkageSuggest', () => {
  it('returns currentPrior when n=0', () => {
    expect(shrinkageSuggest(0.5, 0.2, 0)).toBe(0.2);
  });

  it('weights toward the prior for a small sample', () => {
    // n=5, K=5 -> equal weight (0.5 each)
    const result = shrinkageSuggest(0.4, 0.2, 5);
    expect(result).toBeCloseTo(0.3, 5);
  });

  it('converges toward the observed value as n grows', () => {
    const smallN = shrinkageSuggest(0.4, 0.2, 5);
    const largeN = shrinkageSuggest(0.4, 0.2, 500);
    expect(largeN).toBeGreaterThan(smallN);
    expect(largeN).toBeCloseTo(0.4, 2);
  });

  it('matches the documented formula exactly', () => {
    const n = 10;
    const observed = 0.15;
    const prior = 0.2;
    const expected = (n / (n + SHRINKAGE_K)) * observed + (SHRINKAGE_K / (n + SHRINKAGE_K)) * prior;
    expect(shrinkageSuggest(observed, prior, n)).toBeCloseTo(expected, 10);
  });
});

describe('poolByTradeAndState', () => {
  const rows: OutcomeRow[] = [
    { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 100, moneyKwClicks: 20, callsInWeek: 4 },
    { niche: 'commercial roofing repair', state: 'AZ', moneyKwImpressions: 50, moneyKwClicks: 10, callsInWeek: 1 },
    { niche: 'residential roofing', state: 'TX', moneyKwImpressions: 200, moneyKwClicks: 30, callsInWeek: 5 },
    { niche: 'totally unknown exotic trade xyz', state: 'AZ', moneyKwImpressions: 999, moneyKwClicks: 999, callsInWeek: 999 },
  ];

  it('pools clicks/impressions/calls by canonical trade (sum, not avg of ratios)', () => {
    const groups = poolByTradeAndState(rows);
    const roofGroup = groups.find((g) => g.scope === 'trade' && g.trade === 'roof');
    expect(roofGroup).toBeDefined();
    // 20 + 10 + 30 = 60 clicks pooled across all three roofing rows (both states)
    expect(roofGroup!.pooledClicks).toBe(60);
    expect(roofGroup!.pooledImpressions).toBe(350);
    expect(roofGroup!.pooledCalls).toBe(10);
  });

  it('excludes rows whose niche has no benchmark match', () => {
    const groups = poolByTradeAndState(rows);
    // the "totally unknown" row (999s) must not leak into any group's pool.
    for (const g of groups) {
      expect(g.pooledClicks).not.toBe(999);
      expect(g.pooledImpressions).not.toBe(999);
    }
  });

  it('produces separate trade_state groups per state', () => {
    const groups = poolByTradeAndState(rows);
    const az = groups.find((g) => g.scope === 'trade_state' && g.trade === 'roof' && g.state === 'AZ');
    const tx = groups.find((g) => g.scope === 'trade_state' && g.trade === 'roof' && g.state === 'TX');
    expect(az).toBeDefined();
    expect(tx).toBeDefined();
    expect(az!.pooledClicks).toBe(30); // 20 + 10
    expect(tx!.pooledClicks).toBe(30);
  });

  it('computes observedCtr/observedCallRate as pooled ratios', () => {
    const groups = poolByTradeAndState(rows);
    const roofGroup = groups.find((g) => g.scope === 'trade' && g.trade === 'roof')!;
    expect(roofGroup.observedCtr).toBeCloseTo(60 / 350, 10);
    expect(roofGroup.observedCallRate).toBeCloseTo(10 / 60, 10);
  });
});

describe('buildSuggestions', () => {
  const currentGlobalCtrPrior = 0.2;
  const currentGlobalCallRatePrior = 0.1;

  it('always emits a global suggestion when pooled data exists (both knobs)', () => {
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 1000, moneyKwClicks: 100, callsInWeek: 10 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    const globalCtr = drafts.find((d) => d.scope === 'global' && d.knob === 'scout_ctr_at_rank');
    const globalCallRate = drafts.find((d) => d.scope === 'global' && d.knob === 'scout_call_rate');
    expect(globalCtr).toBeDefined();
    expect(globalCallRate).toBeDefined();
    expect(globalCtr!.trade).toBeNull();
    expect(globalCtr!.state).toBeNull();
  });

  it('does not emit trade/trade_state suggestions below the minimum sample size', () => {
    // 3 clicks total, below MIN_TRADE_SAMPLE (5) and MIN_TRADE_STATE_SAMPLE (3 — exactly at boundary, use 2 to be under)
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 20, moneyKwClicks: 2, callsInWeek: 1 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    const tradeDrafts = drafts.filter((d) => d.scope === 'trade' || d.scope === 'trade_state');
    expect(tradeDrafts).toHaveLength(0);
  });

  it('emits trade-scope suggestions once MIN_TRADE_SAMPLE is met', () => {
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 100, moneyKwClicks: MIN_TRADE_SAMPLE, callsInWeek: 2 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    const tradeDrafts = drafts.filter((d) => d.scope === 'trade' && d.trade === 'roof');
    expect(tradeDrafts.length).toBeGreaterThan(0);
    for (const d of tradeDrafts) {
      expect(d.trade).toBe('roof');
      expect(d.state).toBeNull();
    }
  });

  it('emits trade_state-scope suggestions once MIN_TRADE_STATE_SAMPLE is met (lower threshold than trade)', () => {
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 50, moneyKwClicks: MIN_TRADE_STATE_SAMPLE, callsInWeek: 1 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    const tsDrafts = drafts.filter((d) => d.scope === 'trade_state');
    expect(tsDrafts.length).toBeGreaterThan(0);
    for (const d of tsDrafts) {
      expect(d.state).toBe('AZ');
    }
  });

  it('trade and trade_state suggestions are ALWAYS computed even though they cannot be applied to a global knob', () => {
    // Regression guard for the spec requirement: trade/trade_state suggestions
    // are informational-only but must still be written whenever sample size allows.
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 500, moneyKwClicks: 50, callsInWeek: 5 },
      { niche: 'residential roofing', state: 'TX', moneyKwImpressions: 500, moneyKwClicks: 50, callsInWeek: 5 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    expect(drafts.some((d) => d.scope === 'trade')).toBe(true);
    expect(drafts.some((d) => d.scope === 'trade_state')).toBe(true);
    expect(drafts.some((d) => d.scope === 'global')).toBe(true);
  });

  it('returns no suggestions at all when there are zero money-keyword impressions', () => {
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 0, moneyKwClicks: 0, callsInWeek: 0 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    expect(drafts).toHaveLength(0);
  });

  it('every draft carries an evidence object with the shrinkage inputs', () => {
    const rows: OutcomeRow[] = [
      { niche: 'residential roofing', state: 'AZ', moneyKwImpressions: 1000, moneyKwClicks: 100, callsInWeek: 10 },
    ];
    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });
    for (const d of drafts) {
      expect(d.evidence).toHaveProperty('observed');
      expect(d.evidence).toHaveProperty('currentPrior');
      expect(d.evidence).toHaveProperty('shrinkageK', SHRINKAGE_K);
    }
  });
});
