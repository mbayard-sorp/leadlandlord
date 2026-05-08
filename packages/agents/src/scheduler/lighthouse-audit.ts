import { sql } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import type { ScheduledEvent } from './types';

/**
 * Lighthouse audit scheduler — weekly Mon 07:00 UTC (one hour before the
 * SEO Operator review pass so audit results are fresh in the DB when the
 * operator reads them).
 *
 * Fans out one event per active site against the home URL. When the site
 * has no custom domain attached yet we synthesize a fallback against the
 * shared `*.leadslandlord.com` host using `niche-city-state` as a slug —
 * the audit still gives us a baseline for warming sites pre-domain.
 *
 * Dedupe key: `lighthouse-audit:site:<id>:<url>:<ISO-week>`. URL is in the
 * key so a future scheduler change adding deep-page audits doesn't collide
 * with the home-page audit for the same site×week.
 */
export async function scheduleLighthouseAudit(): Promise<ScheduledEvent[]> {
  const db = getDb();
  const rows = (await db.execute(sql`
    SELECT s.id AS site_id, s.domain AS domain, s.niche AS niche, s.city AS city, s.state AS state
    FROM ${sites} s
    WHERE s.status IN ('warming', 'live', 'rented')
  `)) as unknown as
    | { rows: Array<{ site_id: string; domain: string | null; niche: string; city: string; state: string }> }
    | Array<{ site_id: string; domain: string | null; niche: string; city: string; state: string }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  const week = isoWeekKey(new Date());
  return list.map((r) => {
    const host = r.domain && r.domain.length > 0 ? r.domain : `${slugify(`${r.niche}-${r.city}-${r.state}`)}.leadslandlord.com`;
    const url = `https://${host}`;
    return {
      agent: 'lighthouse-audit',
      payload: { siteId: r.site_id, url, strategy: 'mobile' as const },
      dedupeKey: `lighthouse-audit:site:${r.site_id}:${url}:${week}`,
    };
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
