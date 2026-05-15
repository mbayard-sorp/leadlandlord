import { sql } from 'drizzle-orm';
import { getDb, linkRequests } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Network-linker drain scheduler. Pulls `link_requests` rows that are due
 * (status='pending' AND scheduled_for <= now()) and emits one event per
 * request. The agent processes one request per run and writes a single
 * cross-link approval to agent_approvals.
 *
 * Per-site velocity is enforced in the agent itself via
 * site_network_memberships.link_budget_outbound (default 4) measured over a
 * 30-day rolling window.
 *
 * Dedupe key includes the request id so re-running the same drain in the
 * recent window is a no-op — the agent_events claimable lock further
 * guarantees one execution.
 */
export async function scheduleNetworkLinker(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT lr.id AS request_id, lr.requesting_site_id AS site_id
    FROM ${linkRequests} lr
    WHERE lr.status = 'pending'
      AND lr.scheduled_for <= NOW()
    ORDER BY lr.scheduled_for ASC
    LIMIT 50
  `)) as unknown as
    | { rows: Array<{ request_id: string; site_id: string }> }
    | Array<{ request_id: string; site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  return list.map((r) => ({
    agent: 'network-linker',
    payload: { linkRequestId: r.request_id },
    dedupeKey: `network-linker:request:${r.request_id}`,
  }));
}
