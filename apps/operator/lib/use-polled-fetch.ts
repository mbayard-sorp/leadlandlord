'use client';

import { useEffect, useRef, useState } from 'react';

const DEFAULT_POLL_MS = 4000;

interface UsePolledFetchOptions {
  /** Override poll cadence. Default 4000ms. */
  intervalMs?: number;
  /** Set false to skip the initial fetch and pause polling. */
  enabled?: boolean;
}

interface UsePolledFetchResult<T> {
  data: T | null;
  error: string | null;
  /** True only on the very first load before any data arrives. */
  loading: boolean;
}

/**
 * Plain JSON polling hook used by operator dashboard panels.
 *
 * Mirrors the pattern in AgentActivityPanel.tsx — extracted here so we stop
 * copy-pasting the visibility-aware polling useEffect.
 *
 * Behaviour:
 *   - Fetches `url` immediately on mount, then every `intervalMs`.
 *   - Pauses while `document.visibilityState === 'hidden'` (tab not visible).
 *   - Cancels on unmount; no dangling timers or setState on dead components.
 *   - When a refresh fails, keeps the last successful data and surfaces the
 *     error separately so callers can show a "stale" banner rather than wiping
 *     the UI.
 */
export function usePolledFetch<T>(
  url: string,
  options: UsePolledFetchOptions = {},
): UsePolledFetchResult<T> {
  const { intervalMs = DEFAULT_POLL_MS, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelledRef.current) return;

      // Pause while tab is hidden — avoids hammering the API for background tabs.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, intervalMs);
        return;
      }

      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (cancelledRef.current) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (cancelledRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelledRef.current) {
          setLoading(false);
          timer = setTimeout(tick, intervalMs);
        }
      }
    };

    void tick();

    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, intervalMs, enabled]);

  return { data, error, loading };
}
