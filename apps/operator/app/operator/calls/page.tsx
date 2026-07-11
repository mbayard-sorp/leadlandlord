import Link from 'next/link';
import { Suspense } from 'react';
import { desc } from 'drizzle-orm';
import { getDb, calls, sites, type Call } from '@leadlandlord/db';
import { SiteFilter, type SiteOption } from './SiteFilter';
import { DeleteCallButton } from './DeleteCallButton';
import { Timestamp } from '../../../components/Timestamp';
import { QualificationSummaryCell } from '../../../components/QualificationBadges';

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

  // Distinct sites present in the full unfiltered set for the dropdown.
  // We reuse the already-loaded rows but build options from all calls regardless
  // of the current site_id filter so the dropdown always shows all sites.
  const allRows = await loadCallsSimple({ classification: sp.classification });
  const siteMap = new Map<string, SiteOption>();
  for (const r of allRows) {
    if (!siteMap.has(r.siteId)) {
      siteMap.set(r.siteId, {
        id: r.siteId,
        label: `${r.siteNiche} — ${r.siteCity}, ${r.siteState}`,
      });
    }
  }
  const siteOptions = [...siteMap.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  // KPI helpers
  const totalCalls = rows.length;
  const wonCount = rows.filter((r) => r.classification === 'won').length;
  const winRate = totalCalls > 0 ? Math.round((wonCount / totalCalls) * 100) : 0;
  const voicemailCount = rows.filter((r) => r.isVoicemail).length;
  const rowsWithDuration = rows.filter((r) => r.durationS != null && r.durationS > 0);
  const avgDurationS =
    rowsWithDuration.length > 0
      ? Math.round(rowsWithDuration.reduce((sum, r) => sum + (r.durationS ?? 0), 0) / rowsWithDuration.length)
      : 0;

  function formatDuration(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Calls</h1>
        <p className="text-sm text-slate-400 mt-1">
          Inbound call log across the entire portfolio. Filter by classification.
        </p>
      </header>

      {/* KPI summary */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total calls</p>
          <p className="text-2xl font-semibold mt-2">{totalCalls}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Won</p>
          <p className="text-2xl font-semibold mt-2 text-emerald-300">{wonCount}</p>
          <p className="text-xs text-slate-500 mt-1">{winRate}% win rate</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Voicemails</p>
          <p className="text-2xl font-semibold mt-2">{voicemailCount}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Avg duration</p>
          <p className="text-2xl font-semibold mt-2">
            {rowsWithDuration.length > 0 ? formatDuration(avgDurationS) : '—'}
          </p>
          {rowsWithDuration.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">across {rowsWithDuration.length} calls</p>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <FilterBar current={sp.classification} currentSiteId={sp.site_id} />
        <Suspense>
          <SiteFilter sites={siteOptions} current={sp.site_id} />
        </Suspense>
      </div>

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
                <th>Caller</th>
                <th>From</th>
                <th className="hidden md:table-cell">Dur</th>
                <th>Class</th>
                <th>Qualification</th>
                <th className="hidden md:table-cell">Recording</th>
                <th className="hidden lg:table-cell">Transcript</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/40">
                  <td className="text-slate-400 whitespace-nowrap">
                    <Timestamp value={c.startedAt} />
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
                  <td>
                    {c.callerName ? (
                      <span className="text-slate-200">{c.callerName}</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="text-xs font-mono">
                    {c.callerNumber ? (
                      <a
                        href={`tel:${c.callerNumber}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {c.callerNumber}
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="text-slate-400 hidden md:table-cell">{c.durationS ? `${c.durationS}s` : '—'}</td>
                  <td>
                    <ClassPill v={c.classification} />
                  </td>
                  <td>
                    <QualificationSummaryCell call={c} />
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
                  <td>
                    <DeleteCallButton id={c.id} />
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

function FilterBar({
  current,
  currentSiteId,
}: {
  current: string | undefined;
  currentSiteId: string | undefined;
}) {
  return (
    <>
      {CLASSIFICATIONS.map((c) => {
        const active = (current ?? 'all') === c;
        const params = new URLSearchParams();
        if (c !== 'all') params.set('classification', c);
        if (currentSiteId) params.set('site_id', currentSiteId);
        const qs = params.toString();
        const href = `/operator/calls${qs ? `?${qs}` : ''}`;
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
    </>
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
