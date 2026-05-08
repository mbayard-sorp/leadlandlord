import { NextResponse } from 'next/server';
import { getDb, alertRules, alertEvents, eq, sql } from '@leadlandlord/db';
import { pagerduty } from '@leadlandlord/integrations';
import { log } from '@leadlandlord/shared/log';
import { evaluateRule, type RuleContext } from '@leadlandlord/agents/alert-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Alert-evaluator cron. Runs every 5 minutes:
 *   1. Loads enabled rules from alert_rules
 *   2. For each, runs the named evaluator (queries the relevant data slice
 *      and decides whether the threshold is tripped)
 *   3. If tripped + cooldown elapsed → fires to channels (pagerduty, slack)
 *      and records an alert_events row with channelsFired
 *   4. Stamps last_fired_at on the rule for cooldown tracking
 *
 * Channels are best-effort: a failed channel doesn't prevent other channels
 * from firing or stop the cron. Failures get logged with the alert_event.
 */
export async function GET(req: Request) {
  if (
    process.env.CRON_SECRET &&
    req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const db = getDb();
  const rules = await db.select().from(alertRules).where(eq(alertRules.enabled, true));
  const now = new Date();
  const fired: Array<{ rule: string; severity: string }> = [];
  const skipped: Array<{ rule: string; reason: string }> = [];

  for (const rule of rules) {
    const cooldownMs = (rule.cooldownMinutes ?? 60) * 60 * 1000;
    if (rule.lastFiredAt && now.getTime() - new Date(rule.lastFiredAt).getTime() < cooldownMs) {
      skipped.push({ rule: rule.name, reason: 'cooldown' });
      continue;
    }
    let ctx: RuleContext;
    try {
      ctx = await evaluateRule(rule.name, (rule.thresholds ?? {}) as Record<string, unknown>);
    } catch (err) {
      log.warn(
        { rule: rule.name, err: err instanceof Error ? err.message : err },
        'alert-evaluator: evaluator threw',
      );
      continue;
    }
    if (!ctx.tripped) {
      skipped.push({ rule: rule.name, reason: 'not_tripped' });
      continue;
    }
    const channels = (rule.channels ?? []) as string[];
    const channelsFired: string[] = [];
    if (channels.includes('pagerduty')) {
      const res = await pagerduty.triggerIncident({
        severity: ctx.severity === 'critical' ? 'critical' : ctx.severity === 'warning' ? 'warning' : 'info',
        summary: ctx.summary,
        dedupKey: `leadlandlord:${rule.name}`,
        details: ctx.details,
      });
      if (res.ok) channelsFired.push(res.dryRun ? 'pagerduty:dry_run' : 'pagerduty');
    }
    if (channels.includes('slack')) {
      const ok = await postSlackAlert(ctx.summary, ctx.details);
      if (ok) channelsFired.push('slack');
    }
    await db.insert(alertEvents).values({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: ctx.severity,
      payload: ctx.details as Record<string, unknown>,
      channelsFired,
    });
    await db.update(alertRules).set({ lastFiredAt: now, updatedAt: now }).where(sql`${alertRules.id} = ${rule.id}`);
    fired.push({ rule: rule.name, severity: ctx.severity });
    log.warn({ rule: rule.name, severity: ctx.severity, channelsFired }, 'alert fired');
  }

  return NextResponse.json({ ok: true, evaluated: rules.length, fired, skipped });
}

async function postSlackAlert(summary: string, details: Record<string, unknown>): Promise<boolean> {
  const url = process.env.SLACK_ALERTS_WEBHOOK_URL ?? process.env.SLACK_DIGEST_WEBHOOK_URL;
  if (!url) return false;
  try {
    const detailLines = Object.entries(details)
      .slice(0, 6)
      .map(([k, v]) => `• *${k}*: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('\n');
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `:rotating_light: *${summary}*\n${detailLines}` }),
    });
    return true;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'slack alert post failed');
    return false;
  }
}
