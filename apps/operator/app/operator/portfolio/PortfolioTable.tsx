'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

// Plain-serializable shape mirrored from the Drizzle `sites` row. Dates
// arrive from the server component as ISO strings after JSON transit.
export interface PortfolioRow {
  id: string;
  niche: string;
  city: string;
  state: string;
  status: string;
  trackingNumber: string | null;
  trackingProvider: string | null;
  calls30d: number;
  mrrUsd: string | number;
  createdAt: string;
}

export interface SanityInfo {
  theme: string | null;
  primaryHost: string | null;
  primaryDomainVerified: boolean | null;
  domainCount: number;
}

export interface SiteSnapshot {
  status: string | null;
  mrrUsd: string | number;
  costsUsd: string | number;
}

interface Props {
  rows: PortfolioRow[];
  sanityById: Record<string, SanityInfo>;
  siteSnapById: Record<string, SiteSnapshot>;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function PortfolioTable({ rows, sanityById, siteSnapById }: Props) {
  const [year, setYear] = useState<string>('all');
  const [month, setMonth] = useState<string>('all');

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) {
      const d = new Date(r.createdAt);
      if (!Number.isNaN(d.getTime())) set.add(d.getUTCFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }, [rows]);

  const filtered = useMemo(() => {
    if (year === 'all' && month === 'all') return rows;
    return rows.filter((r) => {
      const d = new Date(r.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      if (year !== 'all' && d.getUTCFullYear() !== Number(year)) return false;
      if (month !== 'all' && d.getUTCMonth() + 1 !== Number(month)) return false;
      return true;
    });
  }, [rows, year, month]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-slate-400">
          <span className="text-xs uppercase tracking-wide text-slate-500">Year</span>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">All</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          <span className="text-xs uppercase tracking-wide text-slate-500">Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            <option value="all">All</option>
            {MONTH_LABELS.map((label, i) => (
              <option key={label} value={i + 1}>{label}</option>
            ))}
          </select>
        </label>
        {(year !== 'all' || month !== 'all') && (
          <>
            <span className="text-xs text-slate-500">
              {filtered.length} of {rows.length} site{rows.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => { setYear('all'); setMonth('all'); }}
              className="text-xs text-sky-300 hover:text-sky-200 underline"
            >
              clear filters
            </button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No sites match the current filters.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Niche</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">City</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Theme</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Primary domain</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Tracking #</th>
                <th className="text-left px-3 py-2">Calls 30d</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">MRR</th>
                <th className="text-left px-3 py-2">Yesterday</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((s) => {
                const sanity = sanityById[s.id];
                const snap = siteSnapById[s.id];
                return (
                  <tr key={s.id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 break-words">
                      <Link href={`/operator/sites/${s.id}`} className="text-sky-400 hover:text-sky-300">
                        {s.niche}
                      </Link>
                      <div className="text-xs text-slate-500 md:hidden">{s.city}, {s.state}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-400 hidden md:table-cell">{s.city}, {s.state}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {sanity?.theme ? (
                        <span className="font-mono text-xs capitalize text-slate-300">{sanity.theme}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      {sanity?.primaryHost ? (
                        <DomainCell
                          host={sanity.primaryHost}
                          verified={sanity.primaryDomainVerified}
                          extra={sanity.domainCount > 1 ? sanity.domainCount - 1 : 0}
                        />
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs hidden lg:table-cell">
                      {s.trackingNumber ?? '—'}
                      {s.trackingProvider === 'mock' && (
                        <span className="ml-2 text-amber-400 text-[10px] uppercase">mock</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{s.calls30d}</td>
                    <td className="px-3 py-2 hidden md:table-cell">${Number(s.mrrUsd).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <SnapshotCell snap={snap} />
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
      : status === 'build_failed'
      ? 'bg-rose-900/50 text-rose-300 border-rose-600/60'
      : status === 'compliance_blocked'
      ? 'bg-amber-900/50 text-amber-300 border-amber-600/60'
      : status === 'paused' || status === 'archived'
      ? 'bg-slate-800/60 text-slate-400 border-slate-700'
      : 'bg-amber-900/30 text-amber-300 border-amber-700/50';
  return <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>;
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

function SnapshotCell({ snap }: { snap: SiteSnapshot | undefined }) {
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
