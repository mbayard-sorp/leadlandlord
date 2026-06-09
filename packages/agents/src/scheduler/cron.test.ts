import { describe, it, expect } from 'vitest';
import { cronPrevFire, isCronDue, isPollDue, compileCron } from './cron';

const d = (iso: string) => new Date(iso);

describe('isPollDue', () => {
  const now = d('2026-06-08T12:00:00Z');
  it('is due when never enqueued', () => {
    expect(isPollDue(null, 10, now)).toBe(true);
  });
  it('is not due before the interval elapses', () => {
    expect(isPollDue(d('2026-06-08T11:55:00Z'), 10, now)).toBe(false);
  });
  it('is due once the interval elapses', () => {
    expect(isPollDue(d('2026-06-08T11:50:00Z'), 10, now)).toBe(true);
    expect(isPollDue(d('2026-06-08T11:49:00Z'), 10, now)).toBe(true);
  });
  it('null/zero interval is never due', () => {
    expect(isPollDue(null, null, now)).toBe(false);
    expect(isPollDue(d('2026-06-08T00:00:00Z'), 0, now)).toBe(false);
  });
});

describe('cronPrevFire — daily/weekly (dow-independent + dow-dependent)', () => {
  it('daily 0 6 * * *: most recent 06:00 UTC at/before now', () => {
    expect(cronPrevFire('0 6 * * *', d('2026-06-08T06:05:00Z'))).toEqual(d('2026-06-08T06:00:00Z'));
    // Before today's fire -> yesterday's.
    expect(cronPrevFire('0 6 * * *', d('2026-06-08T05:59:00Z'))).toEqual(d('2026-06-07T06:00:00Z'));
  });

  it('15 6 * * * respects the minute field', () => {
    expect(cronPrevFire('15 6 * * *', d('2026-06-08T06:20:00Z'))).toEqual(d('2026-06-08T06:15:00Z'));
    expect(cronPrevFire('15 6 * * *', d('2026-06-08T06:10:00Z'))).toEqual(d('2026-06-07T06:15:00Z'));
  });

  it('weekly 0 8 * * 1 lands on a Monday 08:00 UTC at/before now', () => {
    const prev = cronPrevFire('0 8 * * 1', d('2026-06-10T09:00:00Z'));
    expect(prev).not.toBeNull();
    expect(prev!.getUTCDay()).toBe(1); // Monday
    expect(prev!.getUTCHours()).toBe(8);
    expect(prev!.getUTCMinutes()).toBe(0);
    expect(prev!.getTime()).toBeLessThanOrEqual(d('2026-06-10T09:00:00Z').getTime());
  });

  it('*/10 * * * * returns the most recent 10-minute boundary', () => {
    expect(cronPrevFire('*/10 * * * *', d('2026-06-08T12:37:30Z'))).toEqual(d('2026-06-08T12:30:00Z'));
  });
});

describe('isCronDue', () => {
  const now = d('2026-06-08T06:05:00Z'); // just after a daily 06:00 fire
  it('due when a fire occurred since last enqueue', () => {
    expect(isCronDue('0 6 * * *', d('2026-06-08T05:00:00Z'), now)).toBe(true);
  });
  it('not due when already enqueued at/after the last fire', () => {
    expect(isCronDue('0 6 * * *', d('2026-06-08T06:00:00Z'), now)).toBe(false);
    expect(isCronDue('0 6 * * *', d('2026-06-08T06:04:00Z'), now)).toBe(false);
  });
  it('due when never enqueued', () => {
    expect(isCronDue('0 6 * * *', null, now)).toBe(true);
  });
  it('self-heals a missed tick (fire was hours ago, never enqueued since)', () => {
    // last enqueued yesterday; today fired at 06:00; now 09:00 -> still due.
    expect(isCronDue('0 6 * * *', d('2026-06-07T06:00:00Z'), d('2026-06-08T09:00:00Z'))).toBe(true);
  });
});

describe('compileCron validation', () => {
  it('rejects a non-5-field expression', () => {
    expect(() => compileCron('0 6 * *')).toThrow();
  });
  it('rejects an out-of-range value', () => {
    expect(() => compileCron('99 6 * * *')).toThrow();
  });
  it('treats dow 7 and 0 both as Sunday', () => {
    const prev7 = cronPrevFire('0 0 * * 7', d('2026-06-10T00:00:00Z'));
    const prev0 = cronPrevFire('0 0 * * 0', d('2026-06-10T00:00:00Z'));
    expect(prev7).toEqual(prev0);
    expect(prev7!.getUTCDay()).toBe(0);
  });
});
