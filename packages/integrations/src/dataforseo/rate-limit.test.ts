import { describe, it, expect } from 'vitest';
import { createRateLimiter } from './rate-limit';

// Deterministic fake clock: sleep() advances the clock so no real time passes.
function fakeClock() {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    get value() {
      return clock;
    },
  };
}

describe('createRateLimiter', () => {
  it('caps dispatches to maxPerInterval within every rolling 1s window', async () => {
    const c = fakeClock();
    const acquire = createRateLimiter({ maxPerInterval: 8, intervalMs: 1000, now: c.now, sleep: c.sleep });
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      await acquire();
      times.push(c.now());
    }
    expect(times).toHaveLength(30);
    for (const start of times) {
      const inWindow = times.filter((t) => t >= start && t < start + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(8);
    }
  });

  it('does not delay while under the limit', async () => {
    const c = fakeClock();
    const acquire = createRateLimiter({ maxPerInterval: 8, intervalMs: 1000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 8; i++) await acquire();
    expect(c.value).toBe(0); // first maxPerInterval acquisitions are instantaneous
  });

  it('respects a lower limit', async () => {
    const c = fakeClock();
    const acquire = createRateLimiter({ maxPerInterval: 2, intervalMs: 1000, now: c.now, sleep: c.sleep });
    const times: number[] = [];
    for (let i = 0; i < 6; i++) {
      await acquire();
      times.push(c.now());
    }
    for (const start of times) {
      expect(times.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(2);
    }
  });
});
