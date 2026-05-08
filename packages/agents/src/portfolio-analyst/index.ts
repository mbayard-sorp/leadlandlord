/**
 * Portfolio Analyst — daily roll-up of every site's economics.
 *
 * For a given date (defaults to yesterday UTC):
 *
 *  1. Per-site: compute MRR, costs, calls, leads, trial/tenant counts,
 *     a green/amber/red status, and a one-line rationale. Upsert into
 *     `portfolio_snapshots` keyed by (date, siteId).
 *  2. Per-niche: aggregate across sites in each niche → upsert with
 *     siteId=null, niche=value.
 *  3. Portfolio-wide: single row with siteId=null, niche=null.
 *  4. Build a digest (top/bottom MRR, kill recommendations, niche
 *     double-downs, recent maintenance findings) and ship it via Slack
 *     webhook + Resend email when those env vars are present.
 *
 * Status math:
 *   - green: MRR > costs × 5
 *   - amber: MRR > costs (but not green)
 *   - red:   costs > 0 AND MRR == 0 sustained for >30d
 */
import { z } from 'zod';
import { sql, and, eq, gte, lte, isNull, desc, ne } from 'drizzle-orm';
import {
  getDb,
  sites,
  tenants,
  trials,
  agentRuns,
  calls,
  leads,
  portfolioSnapshots,
  maintenanceFindings,
  type Site,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export const PortfolioAnalystInput = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type PortfolioAnalystInput = z.infer<typeof PortfolioAnalystInput>;

export const PortfolioAnalystOutput = z.object({
  date: z.string(),
  sitesProcessed: z.number().int().nonnegative(),
  nichesProcessed: z.number().int().nonnegative(),
  redFlagsCount: z.number().int().nonnegative(),
});
export type PortfolioAnalystOutput = z.infer<typeof PortfolioAnalystOutput>;

// ────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────

export function yesterdayUtc(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface SiteSnapshot {
  siteId: string;
  niche: string;
  mrrUsd: number;
  costsUsd: number;
  callsCount: number;
  leadsCount: number;
  trialActiveCount: number;
  tenantsActiveCount: number;
  status: 'green' | 'amber' | 'red' | null;
  rationale: string;
}

export function classifySiteStatus(
  mrr: number,
  costs: number,
  daysWithZeroMrr: number,
): { status: 'green' | 'amber' | 'red' | null; rationale: string } {
  if (costs > 0 && mrr === 0 && daysWithZeroMrr > 30) {
    return { status: 'red', rationale: `${daysWithZeroMrr}d of zero MRR with $${costs.toFixed(2)} ongoing costs.` };
  }
  if (mrr > costs * 5) {
    return { status: 'green', rationale: `MRR $${mrr.toFixed(2)} > 5× costs $${costs.toFixed(2)}.` };
  }
  if (mrr > costs && costs > 0) {
    return { status: 'amber', rationale: `MRR $${mrr.toFixed(2)} > costs $${costs.toFixed(2)} but margin thin.` };
  }
  if (costs === 0 && mrr === 0) {
    return { status: null, rationale: 'No activity for the day.' };
  }
  return { status: 'amber', rationale: `MRR $${mrr.toFixed(2)} vs costs $${costs.toFixed(2)}.` };
}

export interface DigestInputs {
  perSite: Array<SiteSnapshot & { city: string; state: string }>;
  perNiche: Array<{ niche: string; mrr: number; costs: number; sites: number }>;
  portfolio: { mrr: number; costs: number; sites: number };
  redStreaks: Array<{ siteId: string; niche: string; city: string; days: number }>;
  recentFindings: Array<{ siteId: string | null; category: string; severity: string; detail: string }>;
}

export function formatSlackDigest(date: string, d: DigestInputs): string {
  const lines: string[] = [];
  lines.push(`*Portfolio Daily Digest — ${date}*`);
  lines.push(
    `Portfolio: $${d.portfolio.mrr.toFixed(2)} MRR / $${d.portfolio.costs.toFixed(2)} costs across ${d.portfolio.sites} sites.`,
  );
  if (d.perSite.length > 0) {
    const top = [...d.perSite].sort((a, b) => b.mrrUsd - a.mrrUsd).slice(0, 5);
    lines.push('');
    lines.push('*Top 5 by MRR:*');
    for (const s of top) {
      lines.push(`• ${s.niche} ${s.city}, ${s.state} — $${s.mrrUsd.toFixed(2)}`);
    }
    const withCost = d.perSite.filter((s) => s.costsUsd > 0);
    const bottom = [...withCost].sort((a, b) => a.mrrUsd / a.costsUsd - b.mrrUsd / b.costsUsd).slice(0, 5);
    if (bottom.length > 0) {
      lines.push('');
      lines.push('*Bottom 5 by ROI:*');
      for (const s of bottom) {
        lines.push(`• ${s.niche} ${s.city}, ${s.state} — $${s.mrrUsd.toFixed(2)} / $${s.costsUsd.toFixed(2)}`);
      }
    }
  }
  if (d.redStreaks.length > 0) {
    lines.push('');
    lines.push('*Kill candidates (>30d red):*');
    for (const r of d.redStreaks) {
      lines.push(`• ${r.niche} ${r.city} — ${r.days}d red streak`);
    }
  }
  const doubleDowns = d.perNiche
    .filter((n) => n.costs > 0 && n.mrr / n.costs > 5)
    .sort((a, b) => b.mrr / b.costs - a.mrr / a.costs)
    .slice(0, 5);
  if (doubleDowns.length > 0) {
    lines.push('');
    lines.push('*Double-down niches (avg ROI > 5×):*');
    for (const n of doubleDowns) {
      lines.push(`• ${n.niche} — ROI ${(n.mrr / n.costs).toFixed(1)}× across ${n.sites} site(s)`);
    }
  }
  if (d.recentFindings.length > 0) {
    lines.push('');
    lines.push(`*New maintenance findings (24h):* ${d.recentFindings.length}`);
    for (const f of d.recentFindings.slice(0, 10)) {
      lines.push(`• [${f.severity}] ${f.category} — ${f.detail}`);
    }
  }
  return lines.join('\n');
}

export function formatEmailDigest(date: string, d: DigestInputs): { subject: string; html: string } {
  const subject = `Portfolio digest ${date} — $${d.portfolio.mrr.toFixed(2)} MRR / ${d.portfolio.sites} sites`;
  const top = [...d.perSite].sort((a, b) => b.mrrUsd - a.mrrUsd).slice(0, 5);
  const bottom = [...d.perSite.filter((s) => s.costsUsd > 0)]
    .sort((a, b) => a.mrrUsd / a.costsUsd - b.mrrUsd / b.costsUsd)
    .slice(0, 5);
  const html = `
<h1>Portfolio Daily Digest — ${escapeHtml(date)}</h1>
<p><strong>Portfolio:</strong> $${d.portfolio.mrr.toFixed(2)} MRR / $${d.portfolio.costs.toFixed(2)} costs across ${d.portfolio.sites} sites.</p>
<h2>Top 5 by MRR</h2>
<ul>${top.map((s) => `<li>${escapeHtml(s.niche)} ${escapeHtml(s.city)}, ${escapeHtml(s.state)} — $${s.mrrUsd.toFixed(2)}</li>`).join('')}</ul>
<h2>Bottom 5 by ROI</h2>
<ul>${bottom.map((s) => `<li>${escapeHtml(s.niche)} ${escapeHtml(s.city)}, ${escapeHtml(s.state)} — $${s.mrrUsd.toFixed(2)} / $${s.costsUsd.toFixed(2)}</li>`).join('')}</ul>
${d.redStreaks.length > 0 ? `<h2>Kill candidates (>30d red)</h2><ul>${d.redStreaks.map((r) => `<li>${escapeHtml(r.niche)} ${escapeHtml(r.city)} — ${r.days}d</li>`).join('')}</ul>` : ''}
${d.recentFindings.length > 0 ? `<h2>Maintenance findings (24h): ${d.recentFindings.length}</h2><ul>${d.recentFindings.slice(0, 10).map((f) => `<li>[${escapeHtml(f.severity)}] ${escapeHtml(f.category)} — ${escapeHtml(f.detail)}</li>`).join('')}</ul>` : ''}
`.trim();
  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ────────────────────────────────────────────────────────────
// Persistence helpers
// ────────────────────────────────────────────────────────────

async function upsertSiteSnapshot(date: string, snap: SiteSnapshot, metadata?: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.date, date), eq(portfolioSnapshots.siteId, snap.siteId)))
    .limit(1);
  const values = {
    date,
    siteId: snap.siteId,
    niche: null,
    mrrUsd: snap.mrrUsd.toFixed(2),
    costsUsd: snap.costsUsd.toFixed(4),
    callsCount: snap.callsCount,
    leadsCount: snap.leadsCount,
    trialActiveCount: snap.trialActiveCount,
    tenantsActiveCount: snap.tenantsActiveCount,
    status: snap.status,
    rationale: snap.rationale,
    metadata: metadata ?? null,
  };
  if (existing[0]) {
    await db.update(portfolioSnapshots).set(values).where(eq(portfolioSnapshots.id, existing[0].id));
  } else {
    await db.insert(portfolioSnapshots).values(values);
  }
}

async function upsertNicheSnapshot(
  date: string,
  niche: string,
  agg: { mrr: number; costs: number; calls: number; leads: number; trials: number; tenants: number; sites: number },
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(portfolioSnapshots)
    .where(
      and(
        eq(portfolioSnapshots.date, date),
        isNull(portfolioSnapshots.siteId),
        eq(portfolioSnapshots.niche, niche),
      ),
    )
    .limit(1);
  const values = {
    date,
    siteId: null,
    niche,
    mrrUsd: agg.mrr.toFixed(2),
    costsUsd: agg.costs.toFixed(4),
    callsCount: agg.calls,
    leadsCount: agg.leads,
    trialActiveCount: agg.trials,
    tenantsActiveCount: agg.tenants,
    status: null,
    rationale: null,
    metadata: { sites: agg.sites },
  };
  if (existing[0]) {
    await db.update(portfolioSnapshots).set(values).where(eq(portfolioSnapshots.id, existing[0].id));
  } else {
    await db.insert(portfolioSnapshots).values(values);
  }
}

async function upsertPortfolioSnapshot(
  date: string,
  agg: { mrr: number; costs: number; calls: number; leads: number; trials: number; tenants: number; sites: number },
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select()
    .from(portfolioSnapshots)
    .where(
      and(eq(portfolioSnapshots.date, date), isNull(portfolioSnapshots.siteId), isNull(portfolioSnapshots.niche)),
    )
    .limit(1);
  const values = {
    date,
    siteId: null,
    niche: null,
    mrrUsd: agg.mrr.toFixed(2),
    costsUsd: agg.costs.toFixed(4),
    callsCount: agg.calls,
    leadsCount: agg.leads,
    trialActiveCount: agg.trials,
    tenantsActiveCount: agg.tenants,
    status: null,
    rationale: null,
    metadata: { sites: agg.sites },
  };
  if (existing[0]) {
    await db.update(portfolioSnapshots).set(values).where(eq(portfolioSnapshots.id, existing[0].id));
  } else {
    await db.insert(portfolioSnapshots).values(values);
  }
}

// ────────────────────────────────────────────────────────────
// Digest delivery
// ────────────────────────────────────────────────────────────

async function postSlack(text: string, log: AgentContext['log']): Promise<void> {
  const url = process.env.SLACK_DIGEST_WEBHOOK_URL;
  if (!url) {
    log.info('SLACK_DIGEST_WEBHOOK_URL not set; skipping slack digest');
    return;
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    log.warn({ err: String(err) }, 'slack digest post failed');
  }
}

async function sendDigestEmail(
  subject: string,
  html: string,
  log: AgentContext['log'],
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.OPERATOR_EMAIL;
  if (!apiKey || !to) {
    log.info('RESEND_API_KEY or OPERATOR_EMAIL not set; skipping email digest');
    return;
  }
  try {
    const mod = (await import('@leadlandlord/integrations/resend')) as unknown as {
      sendEmail: (args: {
        to: string;
        from: string;
        subject: string;
        html: string;
      }) => Promise<{ messageId: string }>;
    };
    await mod.sendEmail({
      to,
      from: process.env.OPERATOR_EMAIL_FROM ?? 'operator@leadslandlord.com',
      subject,
      html,
    });
  } catch (err) {
    log.warn({ err: String(err) }, 'email digest send failed');
  }
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

interface CountRow {
  site_id: string;
  c: number;
}

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray((r as any)?.rows)) return (r as any).rows as T[];
  return [];
}

export class PortfolioAnalyst extends BaseAgent<typeof PortfolioAnalystInput, typeof PortfolioAnalystOutput> {
  constructor() {
    super({
      name: 'portfolio-analyst',
      inputSchema: PortfolioAnalystInput,
      outputSchema: PortfolioAnalystOutput,
      defaultDailyCapUsd: 2,
      dedupeKeyFn: (input) => `portfolio-analyst:${input.date ?? yesterdayUtc()}`,
    });
  }

  protected async execute(
    input: z.infer<typeof PortfolioAnalystInput>,
    ctx: AgentContext,
  ): Promise<z.infer<typeof PortfolioAnalystOutput>> {
    const date = input.date ?? yesterdayUtc();
    const db = getDb();

    const allSites = (await db.execute(sql`
      SELECT * FROM ${sites}
      WHERE status IN ('warming', 'live', 'rented', 'paused')
    `)) as unknown;
    const siteList = rowsOf<Site>(allSites);
    ctx.log.info({ count: siteList.length, date }, 'portfolio-analyst starting');

    // Date boundaries (UTC)
    const dayStart = `${date} 00:00:00+00`;
    const dayEnd = `${date} 23:59:59.999+00`;

    // Aggregate calls per site for the date
    const callsRows = rowsOf<CountRow>(
      await db.execute(sql`
        SELECT site_id, COUNT(*)::int AS c
        FROM ${calls}
        WHERE started_at >= ${dayStart} AND started_at <= ${dayEnd}
        GROUP BY site_id
      `),
    );
    const callsBySite = new Map(callsRows.map((r) => [r.site_id, Number(r.c)]));

    const leadsRows = rowsOf<CountRow>(
      await db.execute(sql`
        SELECT site_id, COUNT(*)::int AS c
        FROM ${leads}
        WHERE created_at >= ${dayStart} AND created_at <= ${dayEnd}
        GROUP BY site_id
      `),
    );
    const leadsBySite = new Map(leadsRows.map((r) => [r.site_id, Number(r.c)]));

    const costsRows = rowsOf<{ site_id: string; cost: string }>(
      await db.execute(sql`
        SELECT site_id, COALESCE(SUM(cost_usd), 0)::text AS cost
        FROM ${agentRuns}
        WHERE site_id IS NOT NULL
          AND started_at >= ${dayStart} AND started_at <= ${dayEnd}
        GROUP BY site_id
      `),
    );
    const costsBySite = new Map(costsRows.map((r) => [r.site_id, Number(r.cost)]));

    // MRR — sum monthly_rent_usd / 30 across active tenants on date
    const mrrRows = rowsOf<{ site_id: string; mrr: string }>(
      await db.execute(sql`
        SELECT site_id, COALESCE(SUM(monthly_rent_usd / 30.0), 0)::text AS mrr
        FROM ${tenants}
        WHERE status = 'active'
          AND started_at IS NOT NULL
          AND started_at <= ${dayEnd}
          AND (churned_at IS NULL OR churned_at > ${dayEnd})
        GROUP BY site_id
      `),
    );
    const mrrBySite = new Map(mrrRows.map((r) => [r.site_id, Number(r.mrr)]));

    const tenantsRows = rowsOf<CountRow>(
      await db.execute(sql`
        SELECT site_id, COUNT(*)::int AS c
        FROM ${tenants}
        WHERE status = 'active'
          AND started_at IS NOT NULL
          AND started_at <= ${dayEnd}
          AND (churned_at IS NULL OR churned_at > ${dayEnd})
        GROUP BY site_id
      `),
    );
    const tenantsBySite = new Map(tenantsRows.map((r) => [r.site_id, Number(r.c)]));

    const trialsRows = rowsOf<CountRow>(
      await db.execute(sql`
        SELECT site_id, COUNT(*)::int AS c
        FROM ${trials}
        WHERE started_at <= ${dayEnd}
          AND (ended_at IS NULL OR ended_at > ${dayEnd})
        GROUP BY site_id
      `),
    );
    const trialsBySite = new Map(trialsRows.map((r) => [r.site_id, Number(r.c)]));

    // For red-streak detection, look back 30 days at portfolio_snapshots for same siteId
    const redStreakRows = rowsOf<{ site_id: string; days: number }>(
      await db.execute(sql`
        SELECT site_id, COUNT(*)::int AS days
        FROM ${portfolioSnapshots}
        WHERE site_id IS NOT NULL
          AND status = 'red'
          AND date >= (CURRENT_DATE - INTERVAL '31 days')::text
        GROUP BY site_id
      `),
    );
    const redDaysBySite = new Map(redStreakRows.map((r) => [r.site_id, Number(r.days)]));

    // Build per-site snapshots
    const perSite: Array<SiteSnapshot & { city: string; state: string }> = [];
    let redFlagsCount = 0;
    for (const site of siteList) {
      const mrr = mrrBySite.get(site.id) ?? 0;
      const costs = costsBySite.get(site.id) ?? 0;
      const callsCount = callsBySite.get(site.id) ?? 0;
      const leadsCount = leadsBySite.get(site.id) ?? 0;
      const trialActiveCount = trialsBySite.get(site.id) ?? 0;
      const tenantsActiveCount = tenantsBySite.get(site.id) ?? 0;
      const daysWithZeroMrr = redDaysBySite.get(site.id) ?? 0;
      const { status, rationale } = classifySiteStatus(mrr, costs, daysWithZeroMrr);
      if (status === 'red') redFlagsCount += 1;
      const snap: SiteSnapshot = {
        siteId: site.id,
        niche: site.niche,
        mrrUsd: mrr,
        costsUsd: costs,
        callsCount,
        leadsCount,
        trialActiveCount,
        tenantsActiveCount,
        status,
        rationale,
      };
      perSite.push({ ...snap, city: site.city, state: site.state });
      await upsertSiteSnapshot(date, snap);
    }

    // Per-niche aggregation
    const byNiche = new Map<
      string,
      { mrr: number; costs: number; calls: number; leads: number; trials: number; tenants: number; sites: number }
    >();
    for (const s of perSite) {
      const key = s.niche;
      const cur = byNiche.get(key) ?? { mrr: 0, costs: 0, calls: 0, leads: 0, trials: 0, tenants: 0, sites: 0 };
      cur.mrr += s.mrrUsd;
      cur.costs += s.costsUsd;
      cur.calls += s.callsCount;
      cur.leads += s.leadsCount;
      cur.trials += s.trialActiveCount;
      cur.tenants += s.tenantsActiveCount;
      cur.sites += 1;
      byNiche.set(key, cur);
    }
    for (const [niche, agg] of byNiche.entries()) {
      await upsertNicheSnapshot(date, niche, agg);
    }

    // Portfolio aggregate
    const port = { mrr: 0, costs: 0, calls: 0, leads: 0, trials: 0, tenants: 0, sites: perSite.length };
    for (const s of perSite) {
      port.mrr += s.mrrUsd;
      port.costs += s.costsUsd;
      port.calls += s.callsCount;
      port.leads += s.leadsCount;
      port.trials += s.trialActiveCount;
      port.tenants += s.tenantsActiveCount;
    }
    await upsertPortfolioSnapshot(date, port);

    // Recent maintenance findings (last 24h)
    const findingsRowsRaw = rowsOf<{ site_id: string | null; category: string; severity: string; detail: string }>(
      await db.execute(sql`
        SELECT site_id, category, severity, detail
        FROM ${maintenanceFindings}
        WHERE detected_at >= NOW() - INTERVAL '24 hours'
          AND status = 'open'
        ORDER BY severity DESC, detected_at DESC
        LIMIT 50
      `),
    );
    const findingsRows = findingsRowsRaw.map((r) => ({
      siteId: r.site_id,
      category: r.category,
      severity: r.severity,
      detail: r.detail,
    }));

    const redStreaks = perSite
      .filter((s) => s.status === 'red')
      .map((s) => ({
        siteId: s.siteId,
        niche: s.niche,
        city: s.city,
        days: redDaysBySite.get(s.siteId) ?? 0,
      }))
      .filter((r) => r.days > 30);

    const digest: DigestInputs = {
      perSite,
      perNiche: [...byNiche.entries()].map(([niche, agg]) => ({
        niche,
        mrr: agg.mrr,
        costs: agg.costs,
        sites: agg.sites,
      })),
      portfolio: { mrr: port.mrr, costs: port.costs, sites: port.sites },
      redStreaks,
      recentFindings: findingsRows,
    };

    const slackText = formatSlackDigest(date, digest);
    const email = formatEmailDigest(date, digest);
    await postSlack(slackText, ctx.log);
    await sendDigestEmail(email.subject, email.html, ctx.log);

    return {
      date,
      sitesProcessed: perSite.length,
      nichesProcessed: byNiche.size,
      redFlagsCount,
    };
  }
}
