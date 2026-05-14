'use client';

import type { Backlink } from '@leadlandlord/db';
import { ProspectRowActions } from './ProspectActions';

interface ProspectMetadata {
  run?: boolean;
  dfsRank?: number;
  editorTitle?: string | null;
  editorEmailStatus?: string | null;
  needsManualEditor?: boolean;
  apolloError?: string | null;
  apolloBudgetExhausted?: boolean;
}

interface Props {
  rows: Backlink[];
  /** When provided, omits the per-row site column. */
  hideSiteColumn?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'submitted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'pending'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : status === 'rejected' || status === 'lost'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function ProspectTable({ rows, hideSiteColumn = false }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No prospect rows yet. Run the prospector to discover guest-post targets.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {!hideSiteColumn && <th className="text-left px-3 py-2">Site</th>}
            <th className="text-left px-3 py-2">Target domain</th>
            <th className="text-right px-3 py-2">DFS rank</th>
            <th className="text-left px-3 py-2">Editor</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Pitch</th>
            <th className="text-left px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => {
            const md = (r.metadata ?? {}) as Record<string, unknown>;
            const p = (md.prospect ?? {}) as ProspectMetadata;
            const editorEmail =
              typeof md.targetEditorEmail === 'string' ? md.targetEditorEmail : null;
            return (
              <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                {!hideSiteColumn && (
                  <td className="px-3 py-2 text-xs text-slate-300">{r.siteId.slice(0, 8)}</td>
                )}
                <td className="px-3 py-2 font-mono text-xs text-slate-200">{r.sourceDomain}</td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-300">
                  {p.dfsRank ?? '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.needsManualEditor && !editorEmail ? (
                    <div className="text-amber-300">
                      needs manual editor
                      {p.apolloError ? (
                        <div className="text-slate-500 mt-0.5">Apollo: 404</div>
                      ) : p.apolloBudgetExhausted ? (
                        <div className="text-slate-500 mt-0.5">Apollo cap reached</div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="text-slate-200">{p.editorTitle ?? '—'}</div>
                      <div className="text-slate-400 font-mono">{editorEmail ?? ''}</div>
                      <div className="text-slate-500">
                        {p.editorEmailStatus ? `(${p.editorEmailStatus})` : ''}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-300 max-w-md">
                  {r.subjectLine ? (
                    <div className="font-medium text-slate-200">{r.subjectLine}</div>
                  ) : null}
                  {r.pitchDraft ? (
                    <div className="text-slate-400 mt-0.5">{truncate(r.pitchDraft, 220)}</div>
                  ) : null}
                  {r.rejectionReason ? (
                    <div className="text-red-300/80 text-xs mt-0.5">
                      reason: {truncate(r.rejectionReason, 160)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {r.status === 'pending' ? (
                    <ProspectRowActions
                      id={r.id}
                      hasEmail={!!editorEmail}
                      needsManualEditor={p.needsManualEditor === true}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
