import { sql } from 'drizzle-orm';
import { getDb, sites, prospects } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Tenant Prospector scheduler — runs weekly. For every site that's actively
 * looking for a tenant (status warming/live/rented + warming-or-similar
 * states where we want to keep prospect inventory flowing), enqueue one
 * tenant-prospector event with a target prospect count.
 *
 * Skip rules:
 *   - status NOT IN ('warming', 'live') — sites not currently fishing for tenants
 *   - prospects table already has >= MIN_INVENTORY 'new'-status rows for the
 *     site (don't waste API spend re-prospecting full inventory)
 *
 * Dedupe key: `tenant-prospector:site:<id>:<ISO-week>`. Re-running within
 * the same ISO week is a no-op.
 */

/** Minimum 'new' prospects in inventory before we top up. */
const MIN_INVENTORY = 30;
/** Target headcount per top-up run. */
const TARGET_COUNT = 50;

export async function scheduleTenantProspector(): Promise<ScheduledEvent[]> {
  const db = getDb();
  // Sites in lead-fishing states + a count of 'new' prospects available.
  // The HAVING clause gates on inventory.
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id,
           COUNT(p.id) FILTER (WHERE p.status = 'new') AS new_count
    FROM ${sites} s
    LEFT JOIN ${prospects} p ON p.site_id = s.id
    WHERE s.status IN ('warming', 'live')
    GROUP BY s.id
    HAVING COUNT(p.id) FILTER (WHERE p.status = 'new') < ${MIN_INVENTORY}
  `)) as unknown as { rows: Array<{ site_id: string; new_count: number }> } | Array<{ site_id: string; new_count: number }>;

  const list = Array.isArray(rows) ? rows : rows.rows;
  const week = isoWeekKey(new Date());
  return list.map((r) => ({
    agent: 'tenant-prospector',
    payload: { site_id: r.site_id, count: TARGET_COUNT, exclude_existing: true },
    dedupeKey: `tenant-prospector:site:${r.site_id}:${week}`,
  }));
}

/** ISO week key like "2026-W18" — stable for a given Mon–Sun span. */
function isoWeekKey(d: Date): string {
  // Copy to UTC and shift to Thursday of the same week — the standard ISO trick.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
