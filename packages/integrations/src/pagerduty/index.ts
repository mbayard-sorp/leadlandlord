/**
 * PagerDuty Events API v2 client. Used by the alert-evaluator cron to fire
 * incidents on rule trips. Mock mode (PAGERDUTY_DRY_RUN=true) logs the
 * payload without making the network call — keeps dev/CI quiet.
 *
 * Docs: https://developer.pagerduty.com/docs/events-api-v2
 */

const EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export interface TriggerArgs {
  /** 'critical' | 'error' | 'warning' | 'info' — PagerDuty severity. */
  severity: 'critical' | 'error' | 'warning' | 'info';
  /** Short summary shown in the PagerDuty incident list. */
  summary: string;
  /**
   * Idempotency / aggregation key. Subsequent triggers with the same key
   * are de-duplicated by PagerDuty into the same incident, so callers
   * should derive this from the rule + scope (e.g. `agent_failure_rate`).
   */
  dedupKey: string;
  details?: Record<string, unknown>;
  /** Source identifier for the event (defaults to 'leadlandlord-operator'). */
  source?: string;
}

export interface TriggerResult {
  ok: boolean;
  /** PagerDuty's dedup_key echo, or the one we sent on dry-run. */
  dedupKey: string;
  /** Set in dry-run mode so callers can tell. */
  dryRun?: boolean;
  status?: number;
}

/**
 * Trigger a PagerDuty incident. Returns `{ ok: false }` on transport / API
 * errors so the caller can record + continue (alerting must not throw).
 *
 * Required env: `PAGERDUTY_ROUTING_KEY` (Events API integration key).
 * Set `PAGERDUTY_DRY_RUN=true` to short-circuit + log only.
 */
export async function triggerIncident(args: TriggerArgs): Promise<TriggerResult> {
  const dryRun = process.env.PAGERDUTY_DRY_RUN === 'true';
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;

  if (dryRun || !routingKey) {
    // Dry-run path: when there's no routing key configured we don't blow up,
    // we just no-op and tell the caller. This is the default in dev.
    // eslint-disable-next-line no-console
    console.log('[pagerduty] dry-run', {
      severity: args.severity,
      summary: args.summary,
      dedupKey: args.dedupKey,
      details: args.details,
      reason: dryRun ? 'PAGERDUTY_DRY_RUN=true' : 'no PAGERDUTY_ROUTING_KEY',
    });
    return { ok: true, dedupKey: args.dedupKey, dryRun: true };
  }

  const body = {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: args.dedupKey,
    payload: {
      summary: args.summary,
      severity: args.severity,
      source: args.source ?? 'leadlandlord-operator',
      custom_details: args.details ?? {},
    },
  };

  try {
    const res = await fetch(EVENTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.warn('[pagerduty] non-2xx response', { status: res.status, body: text.slice(0, 500) });
      return { ok: false, dedupKey: args.dedupKey, status: res.status };
    }
    return { ok: true, dedupKey: args.dedupKey, status: res.status };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[pagerduty] fetch failed', { err: err instanceof Error ? err.message : err });
    return { ok: false, dedupKey: args.dedupKey };
  }
}
