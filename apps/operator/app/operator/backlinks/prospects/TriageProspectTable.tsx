'use client';

import type { BacklinkProspect } from '@leadlandlord/db';

interface Props {
  rows: BacklinkProspect[];
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'approved' || status === 'converted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'flagged_top5'
        ? 'bg-sky-900/40 text-sky-300 border-sky-700/50'
        : status === 'scored'
          ? 'bg-indigo-900/40 text-indigo-300 border-indigo-700/50'
          : status === 'rejected'
            ? 'bg-red-900/40 text-red-300 border-red-700/50'
            : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

export function TriageProspectTable({ rows }: Props) {
  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Domain</th>
            <th className="text-right px-3 py-2 hidden md:table-cell">DFS rank</th>
            <th className="text-right px-3 py-2 hidden md:table-cell">Score</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => {
            const md = (r.metadata ?? {}) as Record<string, unknown>;
            const apolloBudgetExhausted = md.apolloBudgetExhausted === true;
            const apolloError = typeof md.apolloError === 'string' ? md.apolloError : null;
            return (
              <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                <td className="px-3 py-2 font-mono text-xs text-slate-200 break-words">
                  {r.domain}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-300 hidden md:table-cell">
                  {r.domainRank ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-300 hidden md:table-cell">
                  {r.score ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-400 hidden lg:table-cell">
                  {r.rationale ? <div className="text-slate-300">{r.rationale}</div> : null}
                  {apolloBudgetExhausted ? <div>Apollo skipped/cap reached</div> : null}
                  {apolloError ? <div>Apollo: {apolloError}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
