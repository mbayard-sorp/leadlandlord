import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { getDb, calls, sites, type Call } from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

interface CallRow extends Call {
  siteNiche: string;
  siteCity: string;
  siteState: string;
}

interface SearchParams {
  searchParams: Promise<{ classification?: string; site_id?: string }>;
}

export default async function CallsPage({ searchParams }: SearchParams) {
  const sp = await searchParams;
  const rows = await loadCallsSimple(sp);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Calls</h1>
        <p className="text-sm text-slate-400 mt-1">
          Inbound call log across the entire portfolio. Filter by classification.
        </p>
      </header>

      <FilterBar current={sp.classification} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No calls match the current filter.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:bg-slate-900 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_td]:px-3 [&_td]:py-2 [&_tbody]:divide-y [&_tbody]:divide-slate-800">
            <thead>
              <tr>
                <th>When</th>
                <th>Site</th>
                <th>From</th>
                <th className="hidden md:table-cell">Dur</th>
                <th>Class</th>
                <th className="hidden md:table-cell">Recording</th>
                <th className="hidden lg:table-cell">Transcript</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/40">
                  <td className="text-slate-400 whitespace-nowrap">
                    {new Date(c.startedAt).toLocaleString()}
                  </td>
                  <td className="break-words">
                    <Link
                      href={`/operator/sites/${c.siteId}`}
                      className="text-sky-400 hover:text-sky-300"
                    >
                      {c.siteNiche}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {c.siteCity}, {c.siteState}
                    </div>
                  </td>
                  <td className="font-mono text-xs">
                    {c.callerNumber ? (
                      <a
                        href={`tel:${c.callerNumber}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {c.callerNumber}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-slate-400 hidden md:table-cell">{c.durationS ? `${c.durationS}s` : '—'}</td>
                  <td>
                    <ClassPill v={c.classification} />
                  </td>
                  <td className="hidden md:table-cell">
                    {c.recordingUrl ? (
                      <audio
                        src={`/api/operator/calls/${c.id}/recording`}
                        controls
                        preload="none"
                        className="h-8 w-full sm:max-w-[200px]"
                      />
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-300 max-w-[280px] hidden lg:table-cell">
                    {c.transcript ? (
                      <details>
                        <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                          {truncate(c.transcript, 60)}
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">{c.transcript}</p>
                      </details>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Simpler load that uses two queries instead of a Drizzle leftJoin (which has
 * tricky typing with the `eq` helper). One query for calls, one for sites,
 * then merge in JS.
 */
async function loadCallsSimple(filters: {
  classification?: string;
  site_id?: string;
}): Promise<CallRow[]> {
  const db = getDb();
  const allCalls = await db.select().from(calls).orderBy(desc(calls.startedAt)).limit(500);
  const allSites = await db.select().from(sites);
  const siteById = new Map(allSites.map((s) => [s.id, s]));
  let merged: CallRow[] = allCalls
    .map((c) => {
      const s = siteById.get(c.siteId);
      if (!s) return null;
      return {
        ...c,
        siteNiche: s.niche,
        siteCity: s.city,
        siteState: s.state,
      } satisfies CallRow;
    })
    .filter((r): r is CallRow => r !== null);
  if (filters.classification) {
    merged = merged.filter((r) => r.classification === filters.classification);
  }
  if (filters.site_id) {
    merged = merged.filter((r) => r.siteId === filters.site_id);
  }
  return merged.slice(0, 200);
}

const CLASSIFICATIONS = [
  'all',
  'unclassified',
  'won',
  'quoted',
  'lost',
  'spam',
  'no_voicemail',
] as const;

function FilterBar({ current }: { current: string | undefined }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CLASSIFICATIONS.map((c) => {
        const active = (current ?? 'all') === c;
        const href = c === 'all' ? '/operator/calls' : `/operator/calls?classification=${c}`;
        return (
          <Link
            key={c}
            href={href}
            className={`inline-flex items-center min-h-[44px] px-3 rounded border text-xs uppercase tracking-wide ${
              active
                ? 'border-sky-600 bg-sky-900/30 text-sky-200'
                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c}
          </Link>
        );
      })}
    </div>
  );
}

function ClassPill({ v }: { v: string }) {
  const tone =
    v === 'won'
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : v === 'quoted'
      ? 'text-sky-300 border-sky-700/50 bg-sky-900/30'
      : v === 'lost'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : v === 'spam'
      ? 'text-red-300 border-red-700/50 bg-red-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{v}</span>;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}
