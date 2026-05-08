import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerIncident } from './index';

describe('pagerduty.triggerIncident', () => {
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.PAGERDUTY_DRY_RUN;
    delete process.env.PAGERDUTY_ROUTING_KEY;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
  });

  it('dry-runs when no routing key is configured', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const r = await triggerIncident({
      severity: 'critical',
      summary: 'test',
      dedupKey: 'k1',
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dry-runs when PAGERDUTY_DRY_RUN=true even with a key', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'foo';
    process.env.PAGERDUTY_DRY_RUN = 'true';
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const r = await triggerIncident({ severity: 'warning', summary: 's', dedupKey: 'k2' });
    expect(r.dryRun).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to events.pagerduty.com when key is set + not dry-run', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'rk_live';
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 202, text: async () => '' })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const r = await triggerIncident({
      severity: 'critical',
      summary: 'agent failure rate high',
      dedupKey: 'leadlandlord:agent_failure_rate',
      details: { failed: 9, total: 10 },
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://events.pagerduty.com/v2/enqueue');
    const body = JSON.parse((call[1] as { body: string }).body);
    expect(body.routing_key).toBe('rk_live');
    expect(body.event_action).toBe('trigger');
    expect(body.dedup_key).toBe('leadlandlord:agent_failure_rate');
    expect(body.payload.severity).toBe('critical');
  });

  it('returns ok:false on non-2xx without throwing', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'rk_live';
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })) as unknown as typeof fetch;
    const r = await triggerIncident({ severity: 'info', summary: 's', dedupKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
  });
});
