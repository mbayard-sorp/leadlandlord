import { describe, it, expect } from 'vitest';
import {
  withinWindow,
  computeJobTypeMix,
  computeCallVolume,
  computeSeasonality,
  type CallRow,
} from './aggregate';

const NOW = new Date('2026-06-04T00:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

describe('withinWindow', () => {
  it('keeps rows inside the window and drops older ones', () => {
    const rows: CallRow[] = [
      { classification: 'won', startedAt: daysAgo(1) },
      { classification: 'lost', startedAt: daysAgo(89) },
      { classification: 'won', startedAt: daysAgo(120) },
    ];
    const kept = withinWindow(rows, NOW, 90);
    expect(kept).toHaveLength(2);
  });

  it('drops rows with unparseable dates', () => {
    const rows: CallRow[] = [{ classification: 'won', startedAt: 'not-a-date' }];
    expect(withinWindow(rows, NOW, 90)).toHaveLength(0);
  });
});

describe('computeJobTypeMix', () => {
  it('counts by classification and computes shares + sampleSize', () => {
    const rows: CallRow[] = [
      { classification: 'won', startedAt: daysAgo(1) },
      { classification: 'won', startedAt: daysAgo(2) },
      { classification: 'lost', startedAt: daysAgo(3) },
      { classification: 'spam', startedAt: daysAgo(4) },
    ];
    const { value, sampleSize } = computeJobTypeMix(rows);
    expect(sampleSize).toBe(4);
    expect(value.total).toBe(4);
    expect((value.counts as Record<string, number>).won).toBe(2);
    expect((value.shares as Record<string, number>).won).toBe(0.5);
    expect((value.shares as Record<string, number>).lost).toBe(0.25);
  });

  it('treats empty classification as unclassified and handles zero rows', () => {
    const { value, sampleSize } = computeJobTypeMix([{ classification: '', startedAt: daysAgo(1) }]);
    expect(sampleSize).toBe(1);
    expect((value.counts as Record<string, number>).unclassified).toBe(1);

    const empty = computeJobTypeMix([]);
    expect(empty.sampleSize).toBe(0);
    expect(empty.value.total).toBe(0);
  });
});

describe('computeCallVolume', () => {
  it('reports total + per-day average over the window', () => {
    const rows: CallRow[] = Array.from({ length: 90 }, (_, i) => ({
      classification: 'won',
      startedAt: daysAgo(i % 90),
    }));
    const { value, sampleSize } = computeCallVolume(rows, 90);
    expect(sampleSize).toBe(90);
    expect(value.total).toBe(90);
    expect(value.perDay).toBe(1);
    expect(value.windowDays).toBe(90);
  });

  it('guards against divide-by-zero windowDays', () => {
    const { value } = computeCallVolume([{ classification: 'won', startedAt: daysAgo(1) }], 0);
    expect(value.perDay).toBe(0);
  });
});

describe('computeSeasonality', () => {
  it('buckets by calendar month and identifies peak + trough', () => {
    const rows: CallRow[] = [
      { classification: 'won', startedAt: new Date('2026-04-10T00:00:00Z') },
      { classification: 'won', startedAt: new Date('2026-05-10T00:00:00Z') },
      { classification: 'won', startedAt: new Date('2026-05-20T00:00:00Z') },
      { classification: 'won', startedAt: new Date('2026-06-01T00:00:00Z') },
    ];
    const { value, sampleSize } = computeSeasonality(rows);
    expect(sampleSize).toBe(4);
    const byMonth = value.byMonth as Record<string, number>;
    expect(byMonth['2026-05']).toBe(2);
    expect(value.peakMonth).toBe('2026-05');
    expect(value.troughMonth === '2026-04' || value.troughMonth === '2026-06').toBe(true);
  });

  it('returns nulls for peak/trough with no rows', () => {
    const { value, sampleSize } = computeSeasonality([]);
    expect(sampleSize).toBe(0);
    expect(value.peakMonth).toBeNull();
    expect(value.troughMonth).toBeNull();
  });
});
