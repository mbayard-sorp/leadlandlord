import { getDb, sql } from '@leadlandlord/db';

/**
 * Cross-link ROI read-model.
 *
 * Turns "links placed" into "did it move anything" by joining placements to
 * outcomes:
 *   - Rank movement: for target pages that received a cross-link, the average
 *     GSC position before vs after the link was placed (seo_metrics_daily keyed
 *     by the target page URL). A negative delta = the page moved UP.
 *   - Lead/call lift: member-site calls + leads in the trailing 30 days vs the
 *     prior 30 days.
 *
 * This is correlational, not a controlled experiment — it is a directional ROI
 * signal for the operator, not a causal claim.
 */

export interface CrossLinkRoi {
  linkedPages: number;
  posBefore: number | null;
  posAfter: number | null;
  posDelta: number | null; // posAfter - posBefore; negative = improved
  calls30d: number;
  callsPrev30d: number;
  leads30d: number;
  leadsPrev30d: number;
}

const EMPTY: CrossLinkRoi = {
  linkedPages: 0,
  posBefore: null,
  posAfter: null,
  posDelta: null,
  calls30d: 0,
  callsPrev30d: 0,
  leads30d: 0,
  leadsPrev30d: 0,
};

export async function loadNetworkRoi(memberIds: string[]): Promise<CrossLinkRoi> {
  if (memberIds.length === 0) return EMPTY;
  const db = getDb();

  // ── Rank movement on linked target pages ──────────────────────────────────
  // Compare avg position in the 28 days before placement vs the 28 days after,
  // for seo rows whose page == the cross-link's target_url.
  const rankRaw = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT csl.id)::text AS linked_pages,
      AVG(smd.position) FILTER (
        WHERE smd.date <  to_char(csl.placed_at, 'YYYY-MM-DD')
          AND smd.date >= to_char(csl.placed_at - INTERVAL '28 days', 'YYYY-MM-DD')
      )::text AS pos_before,
      AVG(smd.position) FILTER (
        WHERE smd.date >= to_char(csl.placed_at, 'YYYY-MM-DD')
          AND smd.date <  to_char(csl.placed_at + INTERVAL '28 days', 'YYYY-MM-DD')
      )::text AS pos_after
    FROM cross_site_links csl
    JOIN seo_metrics_daily smd
      ON smd.site_id = csl.target_site_id AND smd.page = csl.target_url
    WHERE csl.source_site_id = ANY(${memberIds}) AND csl.status = 'active'
  `)) as unknown as { rows: RankRow[] } | RankRow[];
  const rankRow = (Array.isArray(rankRaw) ? rankRaw : rankRaw.rows)[0];

  // ── Lead/call lift for member sites ───────────────────────────────────────
  const liftRaw = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM calls c
        WHERE c.site_id = ANY(${memberIds})
          AND c.created_at >= NOW() - INTERVAL '30 days')::text AS calls_30d,
      (SELECT COUNT(*) FROM calls c
        WHERE c.site_id = ANY(${memberIds})
          AND c.created_at >= NOW() - INTERVAL '60 days'
          AND c.created_at <  NOW() - INTERVAL '30 days')::text AS calls_prev_30d,
      (SELECT COUNT(*) FROM leads l
        WHERE l.site_id = ANY(${memberIds})
          AND l.created_at >= NOW() - INTERVAL '30 days')::text AS leads_30d,
      (SELECT COUNT(*) FROM leads l
        WHERE l.site_id = ANY(${memberIds})
          AND l.created_at >= NOW() - INTERVAL '60 days'
          AND l.created_at <  NOW() - INTERVAL '30 days')::text AS leads_prev_30d
  `)) as unknown as { rows: LiftRow[] } | LiftRow[];
  const liftRow = (Array.isArray(liftRaw) ? liftRaw : liftRaw.rows)[0];

  const posBefore = num(rankRow?.pos_before);
  const posAfter = num(rankRow?.pos_after);

  return {
    linkedPages: int(rankRow?.linked_pages),
    posBefore,
    posAfter,
    posDelta: posBefore !== null && posAfter !== null ? round2(posAfter - posBefore) : null,
    calls30d: int(liftRow?.calls_30d),
    callsPrev30d: int(liftRow?.calls_prev_30d),
    leads30d: int(liftRow?.leads_30d),
    leadsPrev30d: int(liftRow?.leads_prev_30d),
  };
}

interface RankRow {
  linked_pages: string | null;
  pos_before: string | null;
  pos_after: string | null;
}
interface LiftRow {
  calls_30d: string | null;
  calls_prev_30d: string | null;
  leads_30d: string | null;
  leads_prev_30d: string | null;
}

function int(v: string | null | undefined): number {
  const n = parseInt(v ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}
function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : null;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
