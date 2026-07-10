import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPAM_THROTTLE,
  resolveSpamThrottleConfig,
  shouldDivertRepeatCaller,
} from './index';

describe('shouldDivertRepeatCaller', () => {
  it('forwards calls up to and including the threshold', () => {
    const config = { windowMs: 600_000, maxCallsInWindow: 3 };
    expect(shouldDivertRepeatCaller(1, config)).toBe(false);
    expect(shouldDivertRepeatCaller(3, config)).toBe(false);
  });

  it('diverts once the caller exceeds the threshold', () => {
    const config = { windowMs: 600_000, maxCallsInWindow: 3 };
    expect(shouldDivertRepeatCaller(4, config)).toBe(true);
    expect(shouldDivertRepeatCaller(50, config)).toBe(true);
  });

  it('uses the default policy when none is passed', () => {
    expect(shouldDivertRepeatCaller(DEFAULT_SPAM_THROTTLE.maxCallsInWindow)).toBe(false);
    expect(shouldDivertRepeatCaller(DEFAULT_SPAM_THROTTLE.maxCallsInWindow + 1)).toBe(true);
  });
});

describe('resolveSpamThrottleConfig', () => {
  it('returns defaults for an empty env', () => {
    expect(resolveSpamThrottleConfig({})).toEqual(DEFAULT_SPAM_THROTTLE);
  });

  it('returns null when the throttle is turned off', () => {
    expect(resolveSpamThrottleConfig({ CALL_SPAM_THROTTLE: 'off' })).toBeNull();
  });

  it('honours valid overrides', () => {
    expect(
      resolveSpamThrottleConfig({ CALL_SPAM_WINDOW_MINUTES: '5', CALL_SPAM_MAX_CALLS: '2' }),
    ).toEqual({ windowMs: 5 * 60_000, maxCallsInWindow: 2 });
  });

  it('falls back to defaults for invalid or non-positive overrides', () => {
    expect(
      resolveSpamThrottleConfig({ CALL_SPAM_WINDOW_MINUTES: '-1', CALL_SPAM_MAX_CALLS: 'nope' }),
    ).toEqual(DEFAULT_SPAM_THROTTLE);
  });

  it('floors fractional call thresholds', () => {
    expect(resolveSpamThrottleConfig({ CALL_SPAM_MAX_CALLS: '3.9' })?.maxCallsInWindow).toBe(3);
  });
});
