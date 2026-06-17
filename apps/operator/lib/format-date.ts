/**
 * Date/time formatting for the operator dashboard. All operator timestamps are
 * rendered in the configured display time zone (system_state.operatorTimeZone,
 * migration 0047) rather than the viewer's browser zone, so the dashboard reads
 * consistently regardless of who is looking at it.
 *
 * This module is intentionally framework-free (no 'use client') so it can be
 * called from both Server and Client Components. The React context that carries
 * the active zone lives in apps/operator/components/Timestamp.tsx; prefer the
 * <Timestamp> component for rendering so you never have to thread the zone
 * through props.
 */

export const DEFAULT_TIME_ZONE = 'UTC';

export type TimestampMode = 'datetime' | 'date' | 'time';

const PRESETS: Record<TimestampMode, Intl.DateTimeFormatOptions> = {
  // Mirrors the old new Date(x).toLocaleString() output these call sites used.
  datetime: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  },
  date: { year: 'numeric', month: 'numeric', day: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
};

/**
 * Format a timestamp in the given IANA zone. Tolerant of null/invalid input
 * (returns '') and of a bad zone (falls back to UTC) so it can never throw
 * during render. `options` overrides the mode preset when supplied.
 */
export function formatInTimeZone(
  value: Date | string | number | null | undefined,
  timeZone: string,
  mode: TimestampMode = 'datetime',
  options?: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const opts = options ?? PRESETS[mode];
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: DEFAULT_TIME_ZONE }).format(date);
  }
}
