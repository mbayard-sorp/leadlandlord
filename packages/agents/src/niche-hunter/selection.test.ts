import { describe, it, expect } from 'vitest';
import { selectValidationSet } from './selection';

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
