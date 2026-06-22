import { sql } from 'drizzle-orm';
import { getDb, sites, isCrossLinkPaused } from '@leadlandlord/db';
import { isoWeek } from '../local-content-scout/index';
import type { ScheduledEvent } from './types';

/**
 * Network link-request seeder.
 *
 * The drain scheduler (`network-linker`) only processes link_requests that
 * already exist — but nothing seeded them, so the network was dormant. This
 * scheduler is the missing bootstrap: it fans out one network-linker run per
 * eligible network member, in siteId-mode (the agent creates + processes its own
 * request row).
 *
 * Eligibility:
 *   - membership is active and the site is warming/live/rented,
 *   - the site is under its 30-day outbound link budget (warming sites are
 *     ramped to a budget of 1 so freshly-launched sites don't link-burst),
 *   - no pending/processing link_request already exists for the site.
 *
 * Footprint mitigation: each site fires on a deterministic weekly day-of-week
 * slot (independent of wave-launch cadence) so cross-link velocity never
 * correlates with a coordinated launch. The whole seeder no-ops while the
 * network cross-link kill switch is engaged.
 */
export async function scheduleNetworkLinkRequests(): Promise<ScheduledEvent[]> {
  if (await isCrossLinkPaused()) return [];

  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT
      s.id AS site_id,
      s.status AS site_status,
      m.link_budget_outbound AS budget,
      COALESCE(lc.cnt, 0) AS recent_outbound
    FROM site_network_memberships m
    JOIN ${sites} s ON s.id = m.site_id
    LEFT JOIN (
      SELECT source_site_id, COUNT(*) AS cnt
      FROM cross_site_links
      WHERE placed_at >= NOW() - INTERVAL '30 days'
      GROUP BY source_site_id
    ) lc ON lc.source_site_id = s.id
    WHERE m.status = 'active'
      AND s.status IN ('warming', 'live', 'rented')
      AND NOT EXISTS (
        SELECT 1 FROM link_requests lr
        WHERE lr.requesting_site_id = s.id
          AND lr.status IN ('pending', 'processing')
      )
  `)) as unknown as
    | { rows: Array<NetworkSeedRow> }
    | Array<NetworkSeedRow>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const todayDow = new Date().getUTCDay(); // 0=Sun..6=Sat
  const week = isoWeek(new Date());

  return list
    .filter((r) => {
      const budget = Number(r.budget ?? 4);
      // Warming sites ramp slowly: at most one outbound link until they go live.
      const effectiveBudget = r.site_status === 'warming' ? Math.min(budget, 1) : budget;
      const recent = Number(r.recent_outbound ?? 0);
      return recent < effectiveBudget && siteSlot(r.site_id) === todayDow;
    })
    .map((r) => ({
      agent: 'network-linker',
      payload: { siteId: r.site_id },
      dedupeKey: `network-link-requests:site:${r.site_id}:${week}`,
    }));
}

interface NetworkSeedRow {
  site_id: string;
  site_status: string;
  budget: number | null;
  recent_outbound: number | null;
}

/** Deterministic day-of-week slot for a site (0-6). */
function siteSlot(siteId: string): number {
  let h = 5381;
  for (let i = 0; i < siteId.length; i++) {
    h = ((h * 33) ^ siteId.charCodeAt(i)) >>> 0;
  }
  return h % 7;
}
