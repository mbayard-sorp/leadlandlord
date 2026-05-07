import { sql } from 'drizzle-orm';
import { getDb, tenants, agentEvents } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Churn Recovery scheduler — runs daily as a defensive safety net.
 *
 * The primary trigger for churn-recovery is the Stripe webhook
 * (`customer.subscription.deleted` → emit `tenant.churned` event), but
 * webhooks can drop. This scheduler picks up any tenant churned in the
 * last 7 days that doesn't have a churn-recovery event already enqueued
 * or processed.
 *
 * Dedupe key: `churn-recovery:tenant:<id>` — once per tenant ever.
 */

interface ChurnedRow {
  site_id: string;
  tenant_id: string;
}

export async function scheduleChurnRecovery(): Promise<ScheduledEvent[]> {
  const db = getDb();
  // Tenants churned within the last 7 days, joined to their site, where no
  // churn-recovery event has been seen yet (handled or pending). The agent
  // is dedupe-keyed on (site_id, tenant_id, UTC-day) so re-enqueueing is
  // a no-op execution-side, but we still avoid dirtying the queue.
  const rowsRaw = (await db.execute(sql`
    SELECT t.site_id AS site_id, t.id AS tenant_id
    FROM ${tenants} t
    WHERE t.status = 'churned'
      AND t.churned_at IS NOT NULL
      AND t.churned_at >= NOW() - INTERVAL '7 days'
      AND t.site_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${agentEvents} ae
        WHERE ae.agent = 'churn-recovery'
          AND ae.payload->>'churned_tenant_id' = t.id::text
      )
  `)) as unknown as { rows: ChurnedRow[] } | ChurnedRow[];

  const list = Array.isArray(rowsRaw) ? rowsRaw : rowsRaw.rows;
  return list.map((r) => ({
    agent: 'churn-recovery',
    payload: { site_id: r.site_id, churned_tenant_id: r.tenant_id, target_count: 50 },
    dedupeKey: `churn-recovery:tenant:${r.tenant_id}`,
  }));
}
