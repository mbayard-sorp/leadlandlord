import { describe, it, expect } from 'vitest';
import { spearmanRankCorrelation, summarizeBias } from './accuracy-stats';

describe('spearmanRankCorrelation', () => {
  it('returns 1 for a perfectly monotone-increasing relationship', () => {
    const pairs = [
      { a: 1, b: 10 },
      { a: 2, b: 25 },
      { a: 3, b: 900 },
      { a: 4, b: 901 },
    ];
    expect(spearmanRankCorrelation(pairs)).toBeCloseTo(1, 10);
  });

  it('returns -1 for a perfectly inverse relationship', () => {
    const pairs = [
      { a: 1, b: 40 },
      { a: 2, b: 3 },
      { a: 3, b: 2 },
      { a: 4, b: -7 },
    ];
    expect(spearmanRankCorrelation(pairs)).toBeCloseTo(-1, 10);
  });

  it('handles ties via average ranks', () => {
    // a = [1, 2, 2, 3] → ranks [1, 2.5, 2.5, 4]; b = [1, 2, 3, 4] → [1, 2, 3, 4].
    // Pearson over those ranks = 4.5 / sqrt(4.5 * 5) ≈ 0.9487.
    const pairs = [
      { a: 1, b: 1 },
      { a: 2, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 4 },
    ];
    expect(spearmanRankCorrelation(pairs)).toBeCloseTo(4.5 / Math.sqrt(4.5 * 5), 6);
  });

  it('returns null when n < 3', () => {
    expect(spearmanRankCorrelation([])).toBeNull();
    expect(
      spearmanRankCorrelation([
        { a: 1, b: 2 },
        { a: 2, b: 1 },
      ]),
    ).toBeNull();
  });

  it('returns null under zero variance (all values on one side tied)', () => {
    const pairs = [
      { a: 5, b: 1 },
      { a: 5, b: 2 },
      { a: 5, b: 3 },
    ];
    expect(spearmanRankCorrelation(pairs)).toBeNull();
  });
});

describe('summarizeBias', () => {
  it('returns null for an empty input (no data ≠ zero bias)', () => {
    expect(summarizeBias([])).toBeNull();
  });

  it('computes n, median, and mean for odd n', () => {
    expect(summarizeBias([3, 1, 2])).toEqual({ n: 3, median: 2, mean: 2 });
  });

  it('median averages the two middle values for even n', () => {
    const out = summarizeBias([4, 1, 2, 3])!;
    expect(out.n).toBe(4);
    expect(out.median).toBe(2.5);
    expect(out.mean).toBe(2.5);
  });
});
