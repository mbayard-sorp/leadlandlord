import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getDb, sites, type Site } from '@leadlandlord/db';
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

export default async function PortfolioPage() {
  const [rows, sanityRows] = await Promise.all([
    loadPortfolio(),
    fetchPortfolioFromSanity().catch(() => [] as SanityPortfolioRow[]),
  ]);
  const sanityById = new Map(sanityRows.map((s) => [s.siteId, s]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-400 mt-1">All sites the system has built.</p>
      </header>
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
