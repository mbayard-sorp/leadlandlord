/**
 * Pure statistics helpers for the scout-accuracy report (ADR 0030 Phase 4,
 * S6). No I/O — scripts/scout-accuracy-report.ts feeds these from read-only
 * SELECTs. Kept in the agents package so the math is unit-tested even though
 * the script itself is a thin shell.
 */

/**
 * Average-rank (fractional) ranks for a numeric vector: ties receive the mean
 * of the rank positions they span (standard Spearman tie handling). Ranks are
 * 1-based.
 */
function averageRanks(xs: number[]): number[] {
  const indexed = xs.map((value, i) => ({ value, i }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(xs.length);
  let start = 0;
  while (start < indexed.length) {
    let end = start;
    while (end + 1 < indexed.length && indexed[end + 1]!.value === indexed[start]!.value) end++;
    // Positions start..end (0-based) share the average of ranks start+1..end+1.
    const avgRank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k++) ranks[indexed[k]!.i] = avgRank;
    start = end + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation between the `a` and `b` components of each pair.
 * Computed as the Pearson correlation over average ranks (correct under ties,
 * unlike the 6Σd²/n(n²−1) shortcut). Returns null when n < 3 or either side
 * has zero rank variance (all values tied — correlation is undefined).
 */
export function spearmanRankCorrelation(pairs: Array<{ a: number; b: number }>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const ra = averageRanks(pairs.map((p) => p.a));
  const rb = averageRanks(pairs.map((p) => p.b));
  const meanA = ra.reduce((s, x) => s + x, 0) / n;
  const meanB = rb.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i]! - meanA;
    const db = rb[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Bias summary over a set of predicted/actual ratios. Median is the
 * conventional midpoint (mean of the two middle values for even n). Returns
 * null for an empty input so "no data" never reads as a measured bias of 0.
 */
export function summarizeBias(
  ratios: number[],
): { n: number; median: number; mean: number } | null {
  if (ratios.length === 0) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const mean = sorted.reduce((s, r) => s + r, 0) / sorted.length;
  return { n: sorted.length, median, mean };
}
