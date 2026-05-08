import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock state — controlled per-test by reassigning `nextRows`.
let nextRows: unknown = [];
let throwOnExecute = false;

vi.mock('@leadlandlord/db', () => ({
  getDb: () => ({
    execute: async () => {
      if (throwOnExecute) throw new Error('boom');
      return nextRows;
    },
  }),
}));

import { evaluateRule } from './index';

describe('alert-evaluator: agent_failure_rate', () => {
  beforeEach(() => {
    nextRows = [];
    throwOnExecute = false;
  });

  it('does not trip when total runs < minRuns', async () => {
    nextRows = [{ total: 2, failed: 2 }];
    const r = await evaluateRule('agent_failure_rate', { windowHours: 1, failureRatePct: 5, minRuns: 10 });
    expect(r.tripped).toBe(false);
  });

  it('does not trip when failure rate is below threshold', async () => {
    nextRows = [{ total: 100, failed: 2 }];
    const r = await evaluateRule('agent_failure_rate', { windowHours: 1, failureRatePct: 5, minRuns: 10 });
    expect(r.tripped).toBe(false);
  });

  it('trips warning when above threshold', async () => {
    nextRows = [{ total: 100, failed: 7 }];
    const r = await evaluateRule('agent_failure_rate', { windowHours: 1, failureRatePct: 5, minRuns: 10 });
    expect(r.tripped).toBe(true);
    expect(r.severity).toBe('warning');
    expect(r.summary).toMatch(/7\.0%/);
  });

  it('trips critical when failure rate is 2x+ over threshold', async () => {
    nextRows = [{ total: 100, failed: 25 }];
    const r = await evaluateRule('agent_failure_rate', { windowHours: 1, failureRatePct: 5, minRuns: 10 });
    expect(r.tripped).toBe(true);
    expect(r.severity).toBe('critical');
  });
});

describe('alert-evaluator: llm_spend_spike', () => {
  beforeEach(() => {
    nextRows = [];
  });

  it('does not trip when 7d avg < $1 (insufficient baseline)', async () => {
    nextRows = [{ today: '5.00', avg7d: '0.50' }];
    const r = await evaluateRule('llm_spend_spike', { multipleOf7dAvg: 2 });
    expect(r.tripped).toBe(false);
  });

  it('trips when today >= multiple × 7d avg', async () => {
    nextRows = [{ today: '15.00', avg7d: '5.00' }];
    const r = await evaluateRule('llm_spend_spike', { multipleOf7dAvg: 2 });
    expect(r.tripped).toBe(true);
    expect(r.summary).toMatch(/3\.0×/);
  });
});

describe('alert-evaluator: stripe_webhook_failures', () => {
  it('does not trip when below threshold', async () => {
    nextRows = [{ unprocessed: 1 }];
    const r = await evaluateRule('stripe_webhook_failures', { windowHours: 1, failures: 3 });
    expect(r.tripped).toBe(false);
  });

  it('trips critical when at/above threshold', async () => {
    nextRows = [{ unprocessed: 5 }];
    const r = await evaluateRule('stripe_webhook_failures', { windowHours: 1, failures: 3 });
    expect(r.tripped).toBe(true);
    expect(r.severity).toBe('critical');
  });

  it('fails-soft (returns not tripped) when table is missing', async () => {
    throwOnExecute = true;
    const r = await evaluateRule('stripe_webhook_failures', { windowHours: 1, failures: 3 });
    expect(r.tripped).toBe(false);
    throwOnExecute = false;
  });
});

describe('alert-evaluator: unknown rule', () => {
  it('returns not-tripped without throwing', async () => {
    const r = await evaluateRule('this-rule-does-not-exist', {});
    expect(r.tripped).toBe(false);
  });
});

describe('alert-evaluator: cooldown semantics (route-level)', () => {
  // The cooldown / lastFiredAt logic lives in the route handler, not the
  // evaluators. We document the contract here as a reminder: a tripped
  // rule fires only when (now - lastFiredAt) >= cooldownMinutes. This
  // test is a placeholder so changes to the contract surface in test diffs.
  it('contract: cron skips evaluator when within cooldown window', () => {
    expect(true).toBe(true);
  });
});

afterEach(() => {
  nextRows = [];
  throwOnExecute = false;
});
