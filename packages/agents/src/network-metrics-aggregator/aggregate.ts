/**
 * Pure compute helpers for the network-metrics-aggregator.
 *
 * Each helper takes already-fetched rows and returns a metric `value` body plus
 * a `sampleSize` (the underlying observation count). Keeping these pure makes
 * them trivially unit-testable and keeps the anti-fabrication contract explicit:
 * sampleSize is the honest count of rows the metric was computed from, and the
 * content-data-auditor gates publishing on it.
 *
 * No DB / network / Date.now() side effects — callers pass in `now` where a
 * windowed cutoff is needed.
 */

export interface CallRow {
  /** Call classification — stands in for "job type" in v1 (won/quoted/lost/spam/…). */
  classification: string;
  /** When the call started. */
  startedAt: Date | string;
  /** Estimated job revenue, numeric string or number; null when unknown. */
  estRevenueUsd?: string | number | null;
}

export interface MetricResult {
  value: Record<string, unknown>;
  sampleSize: number;
}

const DAY_MS = 86_400_000;

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rows whose startedAt falls within the last `days` before `now` (inclusive). */
export function withinWindow(rows: CallRow[], now: Date, days: number): CallRow[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return rows.filter((r) => {
    const t = toDate(r.startedAt).getTime();
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });
}

/**
 * job_type_mix — distribution of calls by classification over the window.
 * sampleSize is the total number of classified+unclassified calls counted.
 *
 * value: { counts: { [classification]: n }, shares: { [classification]: 0..1 }, total }
 */
export function computeJobTypeMix(rows: CallRow[]): MetricResult {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const k = r.classification || 'unclassified';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const total = rows.length;
  const shares: Record<string, number> = {};
  for (const [k, n] of Object.entries(counts)) {
    shares[k] = total > 0 ? round4(n / total) : 0;
  }
  return { value: { counts, shares, total }, sampleSize: total };
}

/**
 * call_volume — counts over the window plus a per-day average.
 * sampleSize is the number of calls observed.
 *
 * value: { total, perDay, windowDays }
 */
export function computeCallVolume(rows: CallRow[], windowDays: number): MetricResult {
  const total = rows.length;
  const perDay = windowDays > 0 ? round4(total / windowDays) : 0;
  return { value: { total, perDay, windowDays }, sampleSize: total };
}

/**
 * seasonality — call counts bucketed by calendar month (YYYY-MM).
 * sampleSize is the total number of calls bucketed.
 *
 * value: { byMonth: { 'YYYY-MM': n }, peakMonth, troughMonth }
 */
export function computeSeasonality(rows: CallRow[]): MetricResult {
  const byMonth: Record<string, number> = {};
  for (const r of rows) {
    const d = toDate(r.startedAt);
    if (!Number.isFinite(d.getTime())) continue;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = (byMonth[key] ?? 0) + 1;
  }
  const entries = Object.entries(byMonth);
  let peakMonth: string | null = null;
  let troughMonth: string | null = null;
  if (entries.length > 0) {
    let max = -Infinity;
    let min = Infinity;
    for (const [m, n] of entries) {
      if (n > max) {
        max = n;
        peakMonth = m;
      }
      if (n < min) {
        min = n;
        troughMonth = m;
      }
    }
  }
  const sampleSize = entries.reduce((sum, [, n]) => sum + n, 0);
  return { value: { byMonth, peakMonth, troughMonth }, sampleSize };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
