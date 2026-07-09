import { sql } from 'drizzle-orm';
import { getDb, sites, siteOriginalDataInputs } from '@leadlandlord/db';
import { isoMonth } from '../data-inputs-scaffolder/index';
import type { ScheduledEvent } from './types';

/**
 * Data Inputs Scaffolder scheduler — weekly, only for sites that still have an
 * empty scaffoldable field (missing row, no case-study seeds, no firsthand
 * seeds, or no expertise profile). Deliberately NOT gated on
 * local_content_enabled: the fill is a one-time ~$0.05 pass and having the
 * grounding ready means enrolling a site into the content pilot works
 * immediately; the expensive consumers (auditor/writer) keep their own gates.
 *
 * contrarian_takes is intentionally absent from the emptiness check — the
 * scaffolder never fills it (human-only field).
 *
 * Dedupe: one pass per site per calendar month; a full row is a no-op anyway.
 */
export async function scheduleDataInputsScaffolder(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id
    FROM ${sites} s
    LEFT JOIN ${siteOriginalDataInputs} d ON d.site_id = s.id
    WHERE s.status IN ('warming', 'live', 'rented')
      AND (
        d.id IS NULL
        OR jsonb_array_length(d.case_study_inputs) = 0
        OR jsonb_array_length(d.firsthand_inputs) = 0
        OR d.expertise_profile IS NULL
        OR d.proprietary_facts = '{}'::jsonb
      )
  `)) as unknown as { rows: Array<{ site_id: string }> } | Array<{ site_id: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;

  const month = isoMonth(new Date());
  return list.map((r) => ({
    agent: 'data-inputs-scaffolder',
    payload: { siteId: r.site_id, site_id: r.site_id },
    dedupeKey: `data-inputs-scaffolder:site:${r.site_id}:${month}`,
  }));
}
