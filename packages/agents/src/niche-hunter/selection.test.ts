import { describe, it, expect } from 'vitest';
import { selectValidationSet, selectDiversified } from './selection';

interface C {
  trade: string;
  rank: number;
}
const c = (trade: string, rank: number): C => ({ trade, rank });

describe('selectValidationSet', () => {
  const surfaced = new Set(['roofing', 'plumbing']);

  it('reserves ceil(n*quota) slots for the highest-ranked novel trades', () => {
    const ranked = [
      c('roofing', 1),
      c('plumbing', 2),
      c('roofing', 3),
      c('axe throwing range', 4),
      c('plumbing', 5),
      c('goat landscaping', 6),
      c('roofing', 7),
      c('plumbing', 8),
    ];
    const picked = selectValidationSet(ranked, 4, surfaced, 0.25); // 1 novel slot
    expect(picked).toHaveLength(4);
    // Highest-ranked novel trade (rank 4) takes the quota slot; the rest by EV.
    expect(picked.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });

  it('pulls novel trades up from below the EV cutoff', () => {
    const ranked = [
      c('roofing', 1),
      c('plumbing', 2),
      c('roofing', 3),
      c('plumbing', 4),
      c('plumbing', 5),
      c('goat landscaping', 6),
      c('mobile farrier', 7),
    ];
    const picked = selectValidationSet(ranked, 4, surfaced, 0.5); // 2 novel slots
    // Novel slots: ranks 6, 7; EV fill: ranks 1, 2.
    expect(picked.map((p) => p.rank)).toEqual([1, 2, 6, 7]);
  });

  it('takes at most one candidate per novel trade in the quota slots', () => {
    const ranked = [
      c('goat landscaping', 1),
      c('goat landscaping', 2),
      c('mobile farrier', 3),
      c('roofing', 4),
      c('roofing', 5),
    ];
    const picked = selectValidationSet(ranked, 4, surfaced, 0.5); // 2 novel slots
    // Quota: goat landscaping (1) + mobile farrier (3); fill: 2, 4 by EV.
    expect(picked.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
    // The second goat-landscaping cell came from the EV fill, not the quota.
  });

  it('falls back to EV rank when there are not enough novel trades', () => {
    const ranked = [c('roofing', 1), c('plumbing', 2), c('roofing', 3), c('plumbing', 4)];
    const picked = selectValidationSet(ranked, 3, surfaced, 0.5);
    expect(picked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('clamps n to the candidate count', () => {
    const ranked = [c('roofing', 1), c('goat landscaping', 2)];
    expect(selectValidationSet(ranked, 10, surfaced)).toHaveLength(2);
  });

  it('returns empty for n=0 or empty input', () => {
    expect(selectValidationSet([], 5, surfaced)).toEqual([]);
    expect(selectValidationSet([c('roofing', 1)], 0, surfaced)).toEqual([]);
  });

  it('preserves rank order in the result', () => {
    const ranked = [
      c('roofing', 1),
      c('goat landscaping', 2),
      c('plumbing', 3),
      c('mobile farrier', 4),
    ];
    const picked = selectValidationSet(ranked, 3, surfaced, 0.34);
    const ranks = picked.map((p) => p.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

interface D {
  trade: string;
  category: string;
  rank: number;
}
const d = (trade: string, category: string, rank: number): D => ({ trade, category, rank });

describe('selectDiversified', () => {
  it('caps how many candidates a single trade contributes', () => {
    // 6 PI-lawyer cells, all top-ranked; cap of 2 per trade should let lower-
    // ranked trades surface instead of a single trade sweeping the cut.
    const ranked = [
      d('pi lawyer', 'legal', 1),
      d('pi lawyer', 'legal', 2),
      d('pi lawyer', 'legal', 3),
      d('pi lawyer', 'legal', 4),
      d('roofing', 'home_services', 5),
      d('plumbing', 'home_services', 6),
    ];
    const { selected } = selectDiversified(ranked, 4, { maxPerTrade: 2, maxPerCategory: 99 });
    expect(selected.map((s) => s.rank)).toEqual([1, 2, 5, 6]);
  });

  it('caps how many candidates a single category contributes', () => {
    const ranked = [
      d('pi lawyer', 'legal', 1),
      d('divorce lawyer', 'legal', 2),
      d('dui lawyer', 'legal', 3),
      d('roofing', 'home_services', 4),
      d('hvac', 'home_services', 5),
    ];
    // Legal capped at 2; the third legal cell yields to home_services.
    const { selected } = selectDiversified(ranked, 4, { maxPerTrade: 99, maxPerCategory: 2 });
    expect(selected.map((s) => s.rank)).toEqual([1, 2, 4, 5]);
  });

  it('preserves score-desc order in the returned set', () => {
    const ranked = [
      d('a', 'legal', 1),
      d('a', 'legal', 2),
      d('b', 'home_services', 3),
      d('a', 'legal', 4),
      d('c', 'home_services', 5),
    ];
    const { selected } = selectDiversified(ranked, 5, { maxPerTrade: 1, maxPerCategory: 99 });
    const ranks = selected.map((s) => s.rank);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
  });

  it('backfills from capped-out cells rather than persisting fewer than target', () => {
    // Only 2 distinct trades but target 4 and cap 1/trade: the cap alone would
    // yield 2; backfill must restore the set to the full target of 4.
    const ranked = [
      d('a', 'legal', 1),
      d('a', 'legal', 2),
      d('b', 'home_services', 3),
      d('b', 'home_services', 4),
    ];
    const { selected, excludedByCap } = selectDiversified(ranked, 4, {
      maxPerTrade: 1,
      maxPerCategory: 99,
    });
    expect(selected.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    // Both capped-out cells were backfilled, so the true diversity effect is 0.
    expect(excludedByCap).toBe(0);
  });

  it('reports cells held out by the caps when not backfilled', () => {
    const ranked = [
      d('a', 'legal', 1),
      d('a', 'legal', 2),
      d('a', 'legal', 3),
      d('b', 'home_services', 4),
    ];
    // target 2, cap 1/trade: 'a' contributes 1, 'b' contributes 1; ranks 2 & 3
    // are held out and not backfilled (target already met).
    const { selected, excludedByCap } = selectDiversified(ranked, 2, {
      maxPerTrade: 1,
      maxPerCategory: 99,
    });
    expect(selected.map((s) => s.rank)).toEqual([1, 4]);
    expect(excludedByCap).toBe(2);
  });

  it('returns empty for target 0 or empty input', () => {
    expect(selectDiversified([], 5, { maxPerTrade: 2, maxPerCategory: 2 }).selected).toEqual([]);
    expect(
      selectDiversified([d('a', 'legal', 1)], 0, { maxPerTrade: 2, maxPerCategory: 2 }).selected,
    ).toEqual([]);
  });
});
