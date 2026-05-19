import Link from 'next/link';
import { getDb, prospects, sites, desc, eq, and, gte, isNull, sql } from '@leadlandlord/db';
import { ProspectStatusBadge, ScoreBandBadge, scoreBand } from './badges';

export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function ageLabel(date: Date | string | null): string {
  if (!date) return 'never';
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const BUCKETS: { label: string; statuses: string[] }[] = [
  { label: 'New', statuses: ['new'] },
  { label: 'Touched', statuses: ['contacted'] },
  { label: 'Responding', statuses: ['replied'] },
  { label: 'Trial', statuses: ['accepted_trial'] },
  { label: 'Won', statuses: ['converted'] },
  { label: 'Lost', statuses: ['declined', 'unreachable', 'lost'] },
];

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; niche?: string; band?: string; since?: string }>;
}) {
  const { status, niche, band, since } = await searchParams;
  const db = getDb();

  const rows = await db
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      status: prospects.status,
      scoringMetadata: prospects.scoringMetadata,
      lastOutreachAt: prospects.lastOutreachAt,
      siteId: prospects.siteId,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
    })
    .from(prospects)
    .leftJoin(sites, eq(prospects.siteId, sites.id))
    .orderBy(desc(prospects.lastOutreachAt));

  const bucketCounts = BUCKETS.map((b) => ({
    label: b.label,
    count: rows.filter((r) => b.statuses.includes(r.status)).length,
  }));

  const filtered = rows.filter((r) => {
    if (status && status !== 'all' && r.status !== status) return false;
    if (niche && r.niche !== niche) return false;
    if (band) {
      const sm = r.scoringMetadata as Record<string, unknown> | null;
      const score = typeof sm?.score === 'number' ? sm.score : null;
      const b = scoreBand(score);
      if (b !== band.toUpperCase()) return false;
    }
    if (since && since !== 'any') {
      if (since === 'never') {
        if (r.lastOutreachAt != null) return false;
      } else {
        const days = since === '7d' ? 7 : 30;
        const cutoff = Date.now() - days * 86400000;
        if (!r.lastOutreachAt || new Date(r.lastOutreachAt).getTime() < cutoff) return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Prospects</h1>
        <p className="text-sm text-slate-400 mt-1">Pipeline view across all sites.</p>
      </header>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {bucketCounts.map((b) => (
          <div key={b.label} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs uppercase text-slate-500 tracking-wide">{b.label}</div>
            <div className="text-2xl font-semibold mt-1">{b.count}</div>
          </div>
        ))}
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Status</label>
          <select
            name="status"
            defaultValue={status ?? 'all'}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5"
          >
            <option value="all">All</option>
            <option value="new">new</option>
            <option value="contacted">contacted</option>
            <option value="replied">replied</option>
            <option value="accepted_trial">accepted_trial</option>
            <option value="converted">converted</option>
            <option value="declined">declined</option>
            <option value="unreachable">unreachable</option>
            <option value="lost">lost</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Niche</label>
          <input
            name="niche"
            defaultValue={niche ?? ''}
            placeholder="exact match"
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5 w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Band</label>
          <select
            name="band"
            defaultValue={band ?? ''}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5"
          >
            <option value="">Any</option>
            <option value="A">A (≥80)</option>
            <option value="B">B (50–79)</option>
            <option value="C">C (&lt;50)</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wide">Last outreach</label>
          <select
            name="since"
            defaultValue={since ?? 'any'}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1.5"
          >
            <option value="any">Any</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
            <option value="never">Never</option>
          </select>
        </div>
        <button
          type="submit"
          className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded"
        >
          Filter
        </button>
        {(status || niche || band || since) && (
          <Link
            href="/operator/prospects"
            className="text-sm text-slate-400 hover:text-slate-200 py-1.5"
          >
            Clear
          </Link>
        )}
      </form>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No prospects match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Business</Th>
                <Th>Niche / City</Th>
                <Th>Status</Th>
                <Th>Band</Th>
                <Th>Last Outreach</Th>
                <Th>Site</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const sm = r.scoringMetadata as Record<string, unknown> | null;
                const score = typeof sm?.score === 'number' ? sm.score : null;
                return (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
                    <Td>
                      <Link
                        href={`/operator/prospects/${r.id}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {r.businessName}
                      </Link>
                    </Td>
                    <Td className="text-slate-400">
                      {r.niche ?? '—'}
                      {r.city ? ` / ${r.city}` : ''}
                    </Td>
                    <Td>
                      <ProspectStatusBadge status={r.status} />
                    </Td>
                    <Td>
                      <ScoreBandBadge score={score} />
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap">
                      {ageLabel(r.lastOutreachAt)}
                    </Td>
                    <Td>
                      <Link
                        href={`/operator/sites/${r.siteId}`}
                        className="text-xs text-sky-400 hover:text-sky-300 font-mono"
                      >
                        {r.siteId.slice(0, 8)}…
                      </Link>
                    </Td>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
