/**
 * Minimal dependency-free cron evaluation for the DB-driven tick (orchestrator
 * Phase 3). Supports standard 5-field UTC cron: minute hour day-of-month month
 * day-of-week, with star, step values (every-N), comma lists, and a-b ranges.
 *
 * The tick fires every ~10 minutes and asks "is this scheduler due?" — i.e.
 * has a cron fire time occurred since we last enqueued it. We answer by
 * computing the most recent fire time at or before `now` and comparing it to
 * last_enqueued_at. This self-heals missed ticks and never double-fires (the
 * 7-day __schedule_key dedupe in run-scheduler.ts is the second guard).
 */

interface CompiledCron {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      step = Number(part.slice(slash + 1));
      range = part.slice(0, slash);
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || !Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid cron field "${field}"`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) throw new Error(`cron field "${field}" out of range [${min},${max}]`);
      out.add(v);
    }
  }
  return out;
}

export function compileCron(expr: string): CompiledCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`expected a 5-field cron expression, got "${expr}"`);
  }
  const [mF, hF, domF, monF, dowF] = parts as [string, string, string, string, string];
  const dowsRaw = parseField(dowF, 0, 7);
  // cron day-of-week: both 0 and 7 mean Sunday; normalize 7 -> 0 to match getUTCDay().
  const dows = new Set([...dowsRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minutes: parseField(mF, 0, 59),
    hours: parseField(hF, 0, 23),
    doms: parseField(domF, 1, 31),
    months: parseField(monF, 1, 12),
    dows,
    domRestricted: domF !== '*',
    dowRestricted: dowF !== '*',
  };
}

function matches(c: CompiledCron, date: Date): boolean {
  if (!c.minutes.has(date.getUTCMinutes())) return false;
  if (!c.hours.has(date.getUTCHours())) return false;
  if (!c.months.has(date.getUTCMonth() + 1)) return false;
  const domHit = c.doms.has(date.getUTCDate());
  const dowHit = c.dows.has(date.getUTCDay());
  // Vixie cron semantics: when BOTH day-of-month and day-of-week are restricted,
  // a match on EITHER fires. When only one is restricted, it alone governs.
  if (c.domRestricted && c.dowRestricted) return domHit || dowHit;
  if (c.domRestricted) return domHit;
  if (c.dowRestricted) return dowHit;
  return true;
}

// Safety bound on the backward walk (a touch over a year of minutes). Our crons
// fire at least monthly, so a real prev-fire is found far sooner; this only
// guards a pathological never-matching expression.
const MAX_LOOKBACK_MINUTES = 366 * 24 * 60;

/** Most recent fire time at or before `now` (truncated to the minute), or null. */
export function cronPrevFire(expr: string, now: Date): Date | null {
  const c = compileCron(expr);
  let t = Math.floor(now.getTime() / 60000) * 60000;
  for (let i = 0; i <= MAX_LOOKBACK_MINUTES; i++) {
    const d = new Date(t);
    if (matches(c, d)) return d;
    t -= 60000;
  }
  return null;
}

/**
 * Is a cron scheduler due this tick? True when a fire time has occurred since
 * we last enqueued it (or never enqueued and a fire has occurred at/before now).
 */
export function isCronDue(expr: string, lastEnqueuedAt: Date | null, now: Date): boolean {
  const prev = cronPrevFire(expr, now);
  if (!prev) return false;
  if (!lastEnqueuedAt) return true;
  return prev.getTime() > lastEnqueuedAt.getTime();
}

/** Is a poll scheduler due? True when interval_minutes has elapsed since last enqueue. */
export function isPollDue(
  lastEnqueuedAt: Date | null,
  intervalMinutes: number | null,
  now: Date,
): boolean {
  if (intervalMinutes == null || intervalMinutes <= 0) return false;
  if (!lastEnqueuedAt) return true;
  return now.getTime() - lastEnqueuedAt.getTime() >= intervalMinutes * 60000;
}
