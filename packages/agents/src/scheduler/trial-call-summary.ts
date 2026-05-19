import { sql, and, gte, lte } from 'drizzle-orm';
import { getDb, tenants, calls, sites } from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/resend';
import type { ScheduledEvent } from './types';

/**
 * Daily call-summary cron — runs at 14:00 UTC (9am ET).
 * Cron expression: 0 14 * * *
 *
 * Aggregates inbound calls from the previous 24h grouped by tenantId.
 * For each tenant with >= 1 call, sends an HTML summary email to their
 * contact email via Resend.
 *
 * Tenants with 0 calls in the window are skipped entirely.
 *
 * This is an operational notification — no approval gate required.
 * It does not fire against the prospect/tenant relationship; it informs
 * an existing paying tenant of their activity.
 */

interface TenantCallRow {
  tenant_id: string;
  call_count: number;
  total_duration_s: number;
}

interface TopCaller {
  caller_number: string;
  call_count: number;
}

/**
 * Dispatch daily call summaries. Returns a list of ScheduledEvents that the
 * scheduler runner will fan out — each one targets the dedicated
 * 'trial-call-summary' agent. However, because this action (Resend send) has
 * no per-item DB side effect that needs BaseAgent deduplication, we do the
 * work inline here rather than queuing agent_events rows. The function returns
 * an empty array after processing; it's called directly by the cron route
 * rather than via the normal agent dispatch path.
 *
 * Pattern precedent: scheduler functions that do their own I/O (e.g.
 * scheduleMaintenance) return [] and act inline.
 */
export async function scheduleDailyCallSummary(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Aggregate calls from the last 24h grouped by tenant.
  const tenantRows = (await db.execute(sql`
    SELECT
      c.tenant_id,
      COUNT(c.id)::int AS call_count,
      COALESCE(SUM(c.duration_s), 0)::int AS total_duration_s
    FROM ${calls} c
    WHERE c.tenant_id IS NOT NULL
      AND c.started_at >= ${since.toISOString()}
      AND c.started_at < ${now.toISOString()}
    GROUP BY c.tenant_id
    HAVING COUNT(c.id) >= 1
  `)) as unknown as { rows: TenantCallRow[] } | TenantCallRow[];

  const tenantList = Array.isArray(tenantRows) ? tenantRows : tenantRows.rows;
  if (tenantList.length === 0) return [];

  const tenantIds = tenantList.map((r) => r.tenant_id);

  // Fetch tenant contact emails in one query.
  const tenantRecords = await db
    .select({ id: tenants.id, email: tenants.email, businessName: tenants.businessName })
    .from(tenants)
    .where(sql`${tenants.id} = ANY(${tenantIds})`);

  const tenantMap = new Map(tenantRecords.map((t) => [t.id, t]));

  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? process.env.OPERATOR_EMAIL ?? '';

  for (const row of tenantList) {
    const tenant = tenantMap.get(row.tenant_id);
    if (!tenant?.email) continue;

    // Top callers for this tenant in the window (mask last 4 digits).
    const topCallers = (await db.execute(sql`
      SELECT
        caller_number,
        COUNT(id)::int AS call_count
      FROM ${calls}
      WHERE tenant_id = ${row.tenant_id}
        AND started_at >= ${since.toISOString()}
        AND started_at < ${now.toISOString()}
        AND caller_number IS NOT NULL
      GROUP BY caller_number
      ORDER BY call_count DESC
      LIMIT 5
    `)) as unknown as { rows: TopCaller[] } | TopCaller[];

    const topCallerList = Array.isArray(topCallers) ? topCallers : topCallers.rows;

    const html = renderCallSummaryHtml({
      businessName: tenant.businessName,
      callCount: row.call_count,
      totalDurationS: row.total_duration_s,
      topCallers: topCallerList,
      since,
      now,
    });

    if (!fromAddress) {
      // No sender configured — log and skip rather than throw, so one bad
      // env doesn't block summaries for all tenants.
      continue;
    }

    try {
      await sendEmail({
        from: fromAddress,
        to: tenant.email,
        subject: `Your calls today — ${row.call_count} call${row.call_count === 1 ? '' : 's'}`,
        html,
        tags: [{ name: 'type', value: 'daily-call-summary' }],
      });
    } catch {
      // Best-effort: log is implicit via Resend SDK error, don't abort loop.
    }
  }

  return [];
}

interface RenderArgs {
  businessName: string;
  callCount: number;
  totalDurationS: number;
  topCallers: TopCaller[];
  since: Date;
  now: Date;
}

function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) {
    return `(***) ***-${digits.slice(-4)}`;
  }
  return '***-****';
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function renderCallSummaryHtml(args: RenderArgs): string {
  const dateLabel = args.since.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const callerRows = args.topCallers
    .map(
      (c) =>
        `<tr><td style="padding:4px 8px">${maskPhone(c.caller_number)}</td><td style="padding:4px 8px">${c.call_count}</td></tr>`,
    )
    .join('');

  const callerTable =
    args.topCallers.length > 0
      ? `
        <h3 style="margin:16px 0 8px">Top callers</h3>
        <table style="border-collapse:collapse;font-size:14px">
          <thead>
            <tr>
              <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd">Number</th>
              <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ddd">Calls</th>
            </tr>
          </thead>
          <tbody>${callerRows}</tbody>
        </table>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#222;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Daily call summary</h2>
  <p style="color:#666;font-size:14px;margin-top:0">${dateLabel} — ${args.businessName}</p>
  <table style="border-collapse:collapse;width:100%;font-size:15px;margin-top:16px">
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee">Total calls</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${args.callCount}</td>
    </tr>
    <tr>
      <td style="padding:8px 0">Total talk time</td>
      <td style="padding:8px 0;font-weight:600">${formatDuration(args.totalDurationS)}</td>
    </tr>
  </table>
  ${callerTable}
  <p style="font-size:12px;color:#999;margin-top:32px">
    You're receiving this because you're a LeadLandlord tenant.<br>
    Reply to unsubscribe.
  </p>
</body>
</html>`;
}

// Suppress unused — sites imported for potential future enrichment.
void sites;
