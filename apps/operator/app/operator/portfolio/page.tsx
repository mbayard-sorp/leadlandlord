import Link from 'next/link';
import { desc, and, eq, gte, isNull, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import {
  getDb,
  sites,
  portfolioSnapshots,
  type Site,
  type PortfolioSnapshot,
} from '@leadlandlord/db';
import { fetchPortfolioFromSanity, type SanityPortfolioRow } from '@/lib/sanity-read';

export const revalidate = 30;

const loadPortfolio = unstable_cache(
  async (): Promise<Site[]> => {
    const db = getDb();
    return await db.select().from(sites).orderBy(desc(sites.createdAt)).limit(200);
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
  const sanityById = new Map(sanityRows.map((s) => [s.siteId, s]));
  const siteSnapById = new Map(siteSnaps.filter((s) => s.siteId).map((s) => [s.siteId!, s]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-400 mt-1">All sites the system has built.</p>
      </header>
      <DailySnapshotsPanel rows={portfolioRows} />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No sites yet. Run <code className="text-slate-200">pnpm dry-run</code> to build your first one.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Niche</th>
                <th className="text-left px-3 py-2">City</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Theme</th>
                <th className="text-left px-3 py-2">Primary domain</th>
                <th className="text-left px-3 py-2">Tracking #</th>
                <th className="text-left px-3 py-2">Calls 30d</th>
                <th className="text-left px-3 py-2">MRR</th>
                <th className="text-left px-3 py-2">Yesterday</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((s) => {
                const sanity = sanityById.get(s.id);
                return (
                  <tr key={s.id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <Link
                        href={`/operator/sites/${s.id}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {s.niche}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{s.city}, {s.state}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2">
                      {sanity?.theme ? (
                        <span className="font-mono text-xs capitalize text-slate-300">{sanity.theme}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {sanity?.primaryHost ? (
                        <DomainCell host={sanity.primaryHost} verified={sanity.primaryDomainVerified} extra={sanity.domainCount > 1 ? sanity.domainCount - 1 : 0} />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {s.trackingNumber ?? '—'}
                      {s.trackingProvider === 'mock' && (
                        <span className="ml-2 text-amber-400 text-[10px] uppercase">mock</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{s.calls30d}</td>
                    <td className="px-3 py-2">${Number(s.mrrUsd).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <SnapshotCell snap={siteSnapById.get(s.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'rented'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'warming' || status === 'building'
      ? 'bg-sky-900/40 text-sky-300 border-sky-700/50'
      : status === 'paused' || status === 'archived'
      ? 'bg-slate-800/60 text-slate-400 border-slate-700'
      : 'bg-amber-900/30 text-amber-300 border-amber-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

function DomainCell({ host, verified, extra }: { host: string; verified: boolean | null; extra: number }) {
  return (
    <div className="flex items-center gap-2">
      <a
        href={`https://${host}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 hover:text-sky-300 font-mono text-xs truncate max-w-[200px]"
      >
        {host}
      </a>
      {verified ? (
        <span className="text-emerald-300/80 text-[10px] uppercase tracking-wide">verified</span>
      ) : verified === false ? (
        <span className="text-amber-300/80 text-[10px] uppercase tracking-wide">pending</span>
      ) : null}
      {extra > 0 && <span className="text-slate-500 text-xs">+{extra}</span>}
    </div>
  );
}

function SnapshotCell({ snap }: { snap: PortfolioSnapshot | undefined }) {
  if (!snap) return <span className="text-slate-600">—</span>;
  const tone =
    snap.status === 'green'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : snap.status === 'amber'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : snap.status === 'red'
      ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
      : 'bg-slate-800/60 text-slate-400 border-slate-700';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>
        {snap.status ?? 'idle'}
      </span>
      <span className="text-slate-500 text-xs font-mono">
        ${Number(snap.mrrUsd).toFixed(0)} / ${Number(snap.costsUsd).toFixed(2)}
      </span>
    </div>
  );
}

function DailySnapshotsPanel({ rows }: { rows: PortfolioSnapshot[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-sm text-slate-400">
        <h2 className="text-sm font-semibold text-slate-200">Daily snapshots</h2>
        <p className="mt-1 text-xs text-slate-500">
          The portfolio analyst hasn&apos;t produced any daily roll-ups yet.
        </p>
      </section>
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
    <section className="rounded-lg border border-slate-800 bg-slate-900/30 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Daily snapshots</h2>
        <span className="text-xs text-slate-500">last {ordered.length} day(s)</span>
      </header>
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
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="text-left py-1">Date</th>
            <th className="text-right py-1">MRR</th>
            <th className="text-right py-1">Costs</th>
            <th className="text-right py-1">Calls</th>
            <th className="text-right py-1">Leads</th>
            <th className="text-right py-1">Tenants</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {[...rows].map((r) => (
            <tr key={r.id}>
              <td className="py-1 text-slate-300 font-mono">{r.date}</td>
              <td className="py-1 text-right text-slate-300">${Number(r.mrrUsd).toFixed(2)}</td>
              <td className="py-1 text-right text-slate-300">${Number(r.costsUsd).toFixed(2)}</td>
              <td className="py-1 text-right text-slate-400">{r.callsCount}</td>
              <td className="py-1 text-right text-slate-400">{r.leadsCount}</td>
              <td className="py-1 text-right text-slate-400">{r.tenantsActiveCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
