import { desc, and, eq, isNull, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import {
  getDb,
  sites,
  calls,
  portfolioSnapshots,
  type Site,
  type PortfolioSnapshot,
} from '@leadlandlord/db';
import { fetchPortfolioFromSanity, type SanityPortfolioRow } from '@/lib/sanity-read';
import { PortfolioTable, type SanityInfo, type SiteSnapshot } from './PortfolioTable';

type SiteWithCalls = Site & { calls30dLive: number };

// Render on demand — this is the live operator dashboard. Prerendering
// at build time couples the build to DB schema state (e.g. a new column
// landing in code before its migration is applied to the build's DB),
// which has bitten us once already. ISR/unstable_cache below still
// dedupes within a 30s window.
export const dynamic = 'force-dynamic';
export const revalidate = 30;

const loadPortfolio = unstable_cache(
  async (): Promise<SiteWithCalls[]> => {
    const db = getDb();
    const rows = await db
      .select({
        site: sites,
        calls30dLive: sql<number>`COALESCE(COUNT(${calls.id}) FILTER (WHERE ${calls.startedAt} > NOW() - INTERVAL '30 days'), 0)::int`,
      })
      .from(sites)
      .leftJoin(calls, eq(calls.siteId, sites.id))
      .groupBy(sites.id)
      .orderBy(desc(sites.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.site, calls30dLive: Number(r.calls30dLive) }));
  },
  ['operator-portfolio'],
  { revalidate: 30, tags: ['portfolio'] },
);

async function loadPortfolioSnapshots(): Promise<PortfolioSnapshot[]> {
  const db = getDb();
  return await db
    .select()
    .from(portfolioSnapshots)
    .where(and(isNull(portfolioSnapshots.siteId), isNull(portfolioSnapshots.niche)))
    .orderBy(desc(portfolioSnapshots.date))
    .limit(14);
}

async function loadLatestSiteSnapshots(): Promise<PortfolioSnapshot[]> {
  const db = getDb();
  // Latest available date with site rows
  const dateRow = (await db.execute(sql`
    SELECT MAX(date) AS d FROM ${portfolioSnapshots}
    WHERE site_id IS NOT NULL
  `)) as unknown as { rows: Array<{ d: string | null }> } | Array<{ d: string | null }>;
  const list = Array.isArray(dateRow) ? dateRow : dateRow.rows;
  const latest = list[0]?.d;
  if (!latest) return [];
  return await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.date, latest));
}

export default async function PortfolioPage() {
  const [rows, sanityRows, portfolioRows, siteSnaps] = await Promise.all([
    loadPortfolio(),
    fetchPortfolioFromSanity().catch(() => [] as SanityPortfolioRow[]),
    loadPortfolioSnapshots().catch(() => [] as PortfolioSnapshot[]),
    loadLatestSiteSnapshots().catch(() => [] as PortfolioSnapshot[]),
  ]);
  const sanityById: Record<string, SanityInfo> = Object.fromEntries(
    sanityRows.map((s) => [
      s.siteId,
      {
        theme: s.theme ?? null,
        primaryHost: s.primaryHost ?? null,
        primaryDomainVerified: s.primaryDomainVerified ?? null,
        domainCount: s.domainCount ?? 0,
      },
    ]),
  );
  const siteSnapById: Record<string, SiteSnapshot> = Object.fromEntries(
    siteSnaps
      .filter((s) => s.siteId)
      .map((s) => [
        s.siteId!,
        { status: s.status ?? null, mrrUsd: String(s.mrrUsd), costsUsd: String(s.costsUsd) },
      ]),
  );
  const tableRows = rows.map((r) => ({
    id: r.id,
    niche: r.niche,
    city: r.city,
    state: r.state,
    status: r.status,
    trackingNumber: r.trackingNumber ?? null,
    trackingProvider: r.trackingProvider ?? null,
    calls30d: r.calls30dLive,
    mrrUsd: String(r.mrrUsd),
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-400 mt-1">All sites the system has built.</p>
      </header>
      <DailySnapshotsPanel rows={portfolioRows} />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No sites yet. Run <code className="text-slate-200">pnpm dry-run</code> to build your first one.
        </div>
      ) : (
        <PortfolioTable rows={tableRows} sanityById={sanityById} siteSnapById={siteSnapById} />
      )}
    </div>
  );
}

function DailySnapshotsPanel({ rows }: { rows: PortfolioSnapshot[] }) {
  if (rows.length === 0) {
    return (
      <details className="rounded-lg border border-slate-800 bg-slate-900/30 group">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <span className="text-slate-500 transition-transform group-open:rotate-90">▸</span>
            Daily snapshots
          </h2>
          <span className="text-xs text-slate-500">no data yet</span>
        </summary>
        <p className="px-4 pb-4 text-xs text-slate-500">
          The portfolio analyst hasn&apos;t produced any daily roll-ups yet.
        </p>
      </details>
    );
  }
  // Render oldest → newest left-to-right
  const ordered = [...rows].reverse();
  const mrrValues = ordered.map((r) => Number(r.mrrUsd));
  const costValues = ordered.map((r) => Number(r.costsUsd));
  const maxMrr = Math.max(1, ...mrrValues);
  const maxCost = Math.max(1, ...costValues);
  const w = 600;
  const h = 80;
  const stepX = ordered.length > 1 ? w / (ordered.length - 1) : 0;
  const mrrPath = mrrValues
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(h - (v / maxMrr) * h).toFixed(2)}`)
    .join(' ');
  const costPath = costValues
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(h - (v / maxCost) * h).toFixed(2)}`)
    .join(' ');
  const latest = ordered[ordered.length - 1]!;
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/30 group">
      <summary className="cursor-pointer list-none p-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <span className="text-slate-500 transition-transform group-open:rotate-90">▸</span>
          Daily snapshots
        </h2>
        <span className="text-xs text-slate-500">
          last {ordered.length} day(s) · MRR ${Number(latest.mrrUsd).toFixed(0)} · costs ${Number(latest.costsUsd).toFixed(2)}
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20">
          <path d={mrrPath} stroke="#34d399" strokeWidth="1.5" fill="none" />
          <path d={costPath} stroke="#f472b6" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="flex gap-4 text-xs text-slate-400">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
            MRR (latest ${Number(latest.mrrUsd).toFixed(2)})
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-pink-400 mr-1" />
            Costs (latest ${Number(latest.costsUsd).toFixed(2)})
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left py-1">Date</th>
                <th className="text-right py-1">MRR</th>
                <th className="text-right py-1">Costs</th>
                <th className="text-right py-1">Calls</th>
                <th className="text-right py-1 hidden sm:table-cell">Leads</th>
                <th className="text-right py-1 hidden sm:table-cell">Tenants</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {[...rows].map((r) => (
                <tr key={r.id}>
                  <td className="py-1 text-slate-300 font-mono">{r.date}</td>
                  <td className="py-1 text-right text-slate-300">${Number(r.mrrUsd).toFixed(2)}</td>
                  <td className="py-1 text-right text-slate-300">${Number(r.costsUsd).toFixed(2)}</td>
                  <td className="py-1 text-right text-slate-400">{r.callsCount}</td>
                  <td className="py-1 text-right text-slate-400 hidden sm:table-cell">{r.leadsCount}</td>
                  <td className="py-1 text-right text-slate-400 hidden sm:table-cell">{r.tenantsActiveCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
