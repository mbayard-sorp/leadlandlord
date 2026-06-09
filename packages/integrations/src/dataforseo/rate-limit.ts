/**
 * Shared DataForSEO rate limiter (orchestrator Phase 2).
 *
 * DataForSEO rate-limits aggressively (max 10 req/s). Every request funnels
 * through dfsPost (client.ts), so a single sliding-window limiter there gives
 * network-wide throttling for the keyword + backlinks modules. Default 8 rps
 * leaves headroom under the 10/s ceiling; override via DATAFORSEO_MAX_RPS.
 *
 * The limiter takes injectable `now`/`sleep` so it can be tested with a fake
 * clock (no real-time waits in CI).
 */

export interface RateLimiterOptions {
  /** Max acquisitions allowed within each `intervalMs` window. */
  maxPerInterval: number;
  /** Window length in ms (default 1000). */
  intervalMs?: number;
  /** Clock source (default Date.now). */
  now?: () => number;
  /** Sleep primitive (default setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Returns an `acquire()` that resolves when a request slot is free. Acquisitions
 * are serialized so concurrent callers don't race on the window state.
 */
export function createRateLimiter(opts: RateLimiterOptions): () => Promise<void> {
  const maxPerInterval = Math.max(1, Math.floor(opts.maxPerInterval));
  const intervalMs = opts.intervalMs ?? 1000;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stamps: number[] = [];
  let chain: Promise<void> = Promise.resolve();

  async function acquireInner(): Promise<void> {
    for (;;) {
      const t = now();
      // Drop timestamps that have aged out of the window.
      while (stamps.length > 0) {
        const head = stamps[0];
        if (head !== undefined && head <= t - intervalMs) stamps.shift();
        else break;
      }
      if (stamps.length < maxPerInterval) {
        stamps.push(t);
        return;
      }
      const head = stamps[0];
      const waitMs = head !== undefined ? head + intervalMs - t : 1;
      await sleep(waitMs > 0 ? waitMs : 1);
    }
  }

  return () => {
    const next = chain.then(acquireInner, acquireInner);
    // Keep the chain alive but swallow results so it never rejects/leaks.
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

function parseMaxRps(): number {
  const raw = process.env.DATAFORSEO_MAX_RPS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8;
}

/** Process-wide limiter shared by every dfsPost call. */
export const acquireDataForSeoSlot = createRateLimiter({ maxPerInterval: parseMaxRps() });
