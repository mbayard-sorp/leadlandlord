/**
 * Per-rule evaluators. Each takes the rule's thresholds blob and returns a
 * RuleContext indicating whether the rule tripped + a payload for the
 * resulting alert_events row.
 *
 * Adding a new rule:
 *   1. Add a `case` in `evaluateRule` switching on the rule name
 *   2. Insert the rule into `alert_rules` (seed migration or admin UI)
 *   3. Channels list on the rule decides which fan-out fires
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';

export interface RuleContext {
  tripped: boolean;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  details: Record<string, unknown>;
}

const NOT_TRIPPED: RuleContext = {
  tripped: false,
  severity: 'info',
  summary: '',
  details: {},
};

export async function evaluateRule(name: string, thresholds: Record<string, unknown>): Promise<RuleContext> {
  switch (name) {
    case 'agent_failure_rate':
      return evalAgentFailureRate(thresholds);
    case 'llm_spend_spike':
      return evalLlmSpendSpike(thresholds);
    case 'stripe_webhook_failures':
      return evalStripeWebhookFailures(thresholds);
    case 'ssl_expiry':
      return evalSslExpiry(thresholds);
    case 'domain_expiry':
      return evalDomainExpiry(thresholds);
    default:
      // Unknown rule names short-circuit. We do NOT throw — operators can
      // disable a rule by simply removing its evaluator branch and the
      // cron will keep running for the remaining rules.
      return NOT_TRIPPED;
  }
}

// ────────────────────────────────────────────────────────────
// Rule 1: agent_failure_rate
// Trips when failed agent_runs in the last `windowHours` exceed
// `failureRatePct` % of all runs in that window. Requires `minRuns` runs to
// avoid noisy "1 of 2 failed" pages.
// ────────────────────────────────────────────────────────────
async function evalAgentFailureRate(t: Record<string, unknown>): Promise<RuleContext> {
  const windowHours = num(t.windowHours, 1);
  const failureRatePct = num(t.failureRatePct, 5);
  const minRuns = num(t.minRuns, 10);
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN status IN ('failed', 'budget_exceeded') THEN 1 ELSE 0 END)::int AS failed
    FROM agent_runs
    WHERE started_at >= NOW() - (${windowHours} || ' hours')::interval
  `);
  const row = arrayHead<{ total: number; failed: number }>(rows);
  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  if (total < minRuns) return NOT_TRIPPED;
  const ratePct = total === 0 ? 0 : (failed / total) * 100;
  if (ratePct < failureRatePct) return NOT_TRIPPED;
  return {
    tripped: true,
    severity: ratePct >= failureRatePct * 2 ? 'critical' : 'warning',
    summary: `Agent failure rate ${ratePct.toFixed(1)}% over last ${windowHours}h (${failed}/${total} runs)`,
    details: { windowHours, total, failed, ratePct: ratePct.toFixed(2), threshold: failureRatePct },
  };
}

// ────────────────────────────────────────────────────────────
// Rule 2: llm_spend_spike
// Trips when today's LLM spend (sum cost_usd across agent_runs today) is
// `multipleOf7dAvg`× the average daily spend over the previous 7 days.
// ────────────────────────────────────────────────────────────
async function evalLlmSpendSpike(t: Record<string, unknown>): Promise<RuleContext> {
  const multiple = num(t.multipleOf7dAvg, 2);
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN started_at >= date_trunc('day', NOW()) THEN cost_usd::numeric ELSE 0 END), 0)::text AS today,
      COALESCE(SUM(CASE WHEN started_at >= NOW() - INTERVAL '7 days' AND started_at < date_trunc('day', NOW()) THEN cost_usd::numeric ELSE 0 END) / 7, 0)::text AS avg7d
    FROM agent_runs
    WHERE started_at >= NOW() - INTERVAL '8 days'
  `);
  const row = arrayHead<{ today: string; avg7d: string }>(rows);
  const today = Number(row?.today ?? 0);
  const avg7d = Number(row?.avg7d ?? 0);
  // Need a meaningful baseline before we trip — $1/day floor avoids paging
  // when a fresh portfolio jumps from $0 to $0.50.
  if (avg7d < 1) return NOT_TRIPPED;
  if (today < avg7d * multiple) return NOT_TRIPPED;
  return {
    tripped: true,
    severity: today > avg7d * multiple * 2 ? 'critical' : 'warning',
    summary: `LLM spend today $${today.toFixed(2)} is ${(today / avg7d).toFixed(1)}× the 7d avg ($${avg7d.toFixed(2)})`,
    details: { today_usd: today, avg7d_usd: avg7d, multiple_threshold: multiple },
  };
}

// ────────────────────────────────────────────────────────────
// Rule 3: stripe_webhook_failures
// Trips when stripe_webhook_events has >= `failures` rows received in the
// last `windowHours` that are still not processed (processed_at IS NULL).
// Table is the durable webhook log written by the stripe webhook handler.
// ────────────────────────────────────────────────────────────
async function evalStripeWebhookFailures(t: Record<string, unknown>): Promise<RuleContext> {
  const windowHours = num(t.windowHours, 1);
  const failures = num(t.failures, 3);
  const db = getDb();
  // Tolerant of the table not existing yet — we recently added it as an
  // un-journaled migration; fail-soft if it isn't there in this env.
  let unprocessed = 0;
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS unprocessed
      FROM stripe_webhook_events
      WHERE received_at >= NOW() - (${windowHours} || ' hours')::interval
        AND processed_at IS NULL
    `);
    const row = arrayHead<{ unprocessed: number }>(rows);
    unprocessed = Number(row?.unprocessed ?? 0);
  } catch {
    return NOT_TRIPPED;
  }
  if (unprocessed < failures) return NOT_TRIPPED;
  return {
    tripped: true,
    severity: 'critical',
    summary: `${unprocessed} unprocessed Stripe webhooks in last ${windowHours}h`,
    details: { unprocessed, windowHours, threshold: failures },
  };
}

// ────────────────────────────────────────────────────────────
// Rule 4: ssl_expiry
// Stub: trips when any site's SSL is within `daysBefore` of expiry. We
// don't yet store SSL expiry on the sites row — Cloudflare/Vercel handles
// renewal — so this is a placeholder that stays not-tripped until the
// expiry column is added. Wired up as a no-op so the rule row exists +
// doesn't break the loop.
// ────────────────────────────────────────────────────────────
async function evalSslExpiry(_t: Record<string, unknown>): Promise<RuleContext> {
  return NOT_TRIPPED;
}

// ────────────────────────────────────────────────────────────
// Rule 5: domain_expiry
// Trips when any site's domain has a registered_at older than 11 months
// (roughly), as a proxy for "needs renewal soon" — domain_candidates table
// doesn't store the expiry date directly. Same caveat as ssl_expiry: we
// fail-soft so missing data doesn't trip noise.
// ────────────────────────────────────────────────────────────
async function evalDomainExpiry(t: Record<string, unknown>): Promise<RuleContext> {
  const daysBefore = num(t.daysBefore, 30);
  const db = getDb();
  let count = 0;
  try {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM domain_candidates
      WHERE status = 'registered'
        AND registered_at IS NOT NULL
        AND registered_at <= NOW() - (INTERVAL '1 year' - (${daysBefore} || ' days')::interval)
    `);
    count = Number(arrayHead<{ count: number }>(rows)?.count ?? 0);
  } catch {
    return NOT_TRIPPED;
  }
  if (count === 0) return NOT_TRIPPED;
  return {
    tripped: true,
    severity: 'warning',
    summary: `${count} domain(s) within ${daysBefore} days of 1-year mark — verify auto-renew`,
    details: { count, daysBefore },
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// drizzle's `db.execute` returns slightly different shapes across drivers —
// sometimes an array, sometimes `{ rows: [...] }`. Normalize.
function arrayHead<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) return result[0] as T | undefined;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows[0] as T | undefined;
  }
  return undefined;
}
