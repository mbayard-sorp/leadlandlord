'use client';

/**
 * Renders a timestamp in the operator's configured display time zone.
 *
 * The zone is carried by React context (OperatorTimeZoneProvider, mounted once
 * in apps/operator/app/operator/layout.tsx). Because the provider is server-
 * rendered with the real zone, <Timestamp> formats identically on the server
 * and the client — no hydration mismatch, no browser-local drift.
 *
 * Use <Timestamp value={date} /> anywhere a timestamp is shown instead of
 * new Date(x).toLocaleString(); pass mode="date" / "time" for date- or
 * time-only, or `options` to fully override the format.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_TIME_ZONE, formatInTimeZone, type TimestampMode } from '../lib/format-date';

const TimeZoneContext = createContext<string>(DEFAULT_TIME_ZONE);

export function OperatorTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

/** The active operator display zone, for the rare caller that needs the string. */
export function useOperatorTimeZone(): string {
  return useContext(TimeZoneContext);
}

export function Timestamp({
  value,
  mode = 'datetime',
  options,
  className,
}: {
  value: Date | string | number | null | undefined;
  mode?: TimestampMode;
  options?: Intl.DateTimeFormatOptions;
  className?: string;
}) {
  const timeZone = useOperatorTimeZone();
  return (
    <time className={className} suppressHydrationWarning>
      {formatInTimeZone(value, timeZone, mode, options)}
    </time>
  );
}
