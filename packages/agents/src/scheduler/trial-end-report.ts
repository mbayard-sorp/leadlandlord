import { sql, eq, and, isNull } from 'drizzle-orm';
import { getDb, trials, calls, prospects, sites } from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/resend';
import type { ScheduledEvent } from './types';

/**
 * End-of-trial report — run hourly or alongside the existing trial-manager
 * scheduler (both fire from the same cron chain in the operator route).
 *
 * Identifies trials matching the "ending" predicate:
 *   started_at + 14 days <= now AND decision = 'pending' AND ended_at IS NULL
 *   AND end_report_sent_at IS NULL  (idempotency)
 *
 * For each: aggregates calls + estimated revenue, sends an HTML report via
 * Resend to the operator inbox (OPERATOR_EMAIL env var), and stamps
 * trials.end_report_sent_at to prevent re-sending.
 *
 * The operator reviews and sets won/lost via /operator/trials (Phase 4).
 * This report is purely informational — no approval gate.
 */

interface EndingTrial {
  trial_id: string;
}

interface CallAgg {
  call_count: number;
  won_count: number;
  quoted_count: number;
  total_duration_s: number;
  est_revenue_usd: number;
}

export async function scheduleTrialEndReport(): Promise<ScheduledEvent[]> {
  const db = getDb();

  // Trials past the 14-day mark, still pending, not yet ended, report not sent.
  const rawRows = (await db.execute(sql`
    SELECT id AS trial_id
    FROM ${trials}
    WHERE decision = 'pending'
      AND ended_at IS NULL
      AND end_report_sent_at IS NULL
      AND started_at + INTERVAL '14 days' <= NOW()
  `)) as unknown as { rows: EndingTrial[] } | EndingTrial[];

  const endingList = Array.isArray(rawRows) ? rawRows : rawRows.rows;
  if (endingList.length === 0) return [];

  const operatorEmail = process.env.OPERATOR_EMAIL;
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? operatorEmail ?? '';

  for (const row of endingList) {
    const trial = (
      await db.select().from(trials).where(eq(trials.id, row.trial_id)).limit(1)
    )[0];
    if (!trial) continue;

    // Re-check idempotency at row level (guard against concurrent scheduler runs).
    if (trial.endReportSentAt) continue;

    const site = trial.siteId
      ? (await db.select().from(sites).where(eq(sites.id, trial.siteId)).limit(1))[0]
      : undefined;

    const prospect = trial.prospectId
      ? (await db.select().from(prospects).where(eq(prospects.id, trial.prospectId)).limit(1))[0]
      : undefined;

    // Aggregate calls for this site over the trial window.
    const callAggRaw = (await db.execute(sql`
      SELECT
        COUNT(id)::int AS call_count,
        COUNT(CASE WHEN classification = 'won' THEN 1 END)::int AS won_count,
        COUNT(CASE WHEN classification = 'quoted' THEN 1 END)::int AS quoted_count,
        COALESCE(SUM(duration_s), 0)::int AS total_duration_s,
        COALESCE(SUM(est_revenue_usd::numeric), 0)::numeric AS est_revenue_usd
      FROM ${calls}
      WHERE site_id = ${trial.siteId}
        AND started_at >= ${trial.startedAt.toISOString()}
        AND started_at < NOW()
    `)) as unknown as { rows: CallAgg[] } | CallAgg[];

    const aggList = Array.isArray(callAggRaw) ? callAggRaw : callAggRaw.rows;
    const agg: CallAgg = aggList[0] ?? {
      call_count: 0,
      won_count: 0,
      quoted_count: 0,
      total_duration_s: 0,
      est_revenue_usd: 0,
    };

    const html = renderEndOfTrialHtml({
      trialId: trial.id,
      businessName: prospect?.businessName ?? site?.niche ?? 'Unknown',
      niche: site?.niche ?? '',
      city: site?.city ?? '',
      startedAt: trial.startedAt,
      callCount: agg.call_count,
      wonCount: agg.won_count,
      quotedCount: agg.quoted_count,
      totalDurationS: agg.total_duration_s,
      estRevenueUsd: Number(agg.est_revenue_usd),
      quotedRentUsd: trial.quotedRentUsd ? Number(trial.quotedRentUsd) : null,
    });

    // Stamp before send to handle crashes-after-send gracefully.
    // If send fails the stamp is still set, preventing retry spam; operator
    // can re-run manually if needed.
    await db
      .update(trials)
      .set({ endReportSentAt: new Date() })
      .where(and(eq(trials.id, trial.id), isNull(trials.endReportSentAt)));

    if (operatorEmail && fromAddress) {
      try {
        await sendEmail({
          from: fromAddress,
          to: operatorEmail,
          subject: `Trial ending: ${prospect?.businessName ?? site?.niche ?? 'unknown'} — ${agg.call_count} calls`,
          html,
          tags: [{ name: 'type', value: 'trial-end-report' }],
        });
      } catch {
        // Stamp already set. Operator can check the trials table directly.
      }
    }
  }

  return [];
}

interface RenderEndOfTrialArgs {
  trialId: string;
  businessName: string;
  niche: string;
  city: string;
  startedAt: Date;
  callCount: number;
  wonCount: number;
  quotedCount: number;
  totalDurationS: number;
  estRevenueUsd: number;
  quotedRentUsd: number | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function renderEndOfTrialHtml(args: RenderEndOfTrialArgs): string {
  const startLabel = args.startedAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const operatorDashUrl = process.env.OPERATOR_URL
    ? `${process.env.OPERATOR_URL}/operator/trials`
    : '/operator/trials';

  const rentRow =
    args.quotedRentUsd != null
      ? `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee">Quoted monthly rent</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">$${args.quotedRentUsd.toFixed(2)}</td>
        </tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#222;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Trial ending — decision needed</h2>
  <p style="color:#666;font-size:14px;margin-top:0">
    ${args.businessName} &mdash; ${args.niche} in ${args.city}<br>
    Trial started ${startLabel} &middot; 14 days elapsed
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:15px;margin-top:16px">
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Total calls</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${args.callCount}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Booked (won)</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${args.wonCount}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Quoted</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${args.quotedCount}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Total talk time</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${formatDuration(args.totalDurationS)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Est. revenue from calls</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">$${args.estRevenueUsd.toFixed(2)}</td>
    </tr>
    ${rentRow}
  </table>
  <p style="margin-top:24px">
    <a href="${operatorDashUrl}" style="background:#1a56db;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
      Set decision in dashboard
    </a>
  </p>
  <p style="font-size:11px;color:#999;margin-top:32px">
    Trial ID: ${args.trialId}<br>
    This report was generated automatically. No action is required if you've already decided.
  </p>
</body>
</html>`;
}
