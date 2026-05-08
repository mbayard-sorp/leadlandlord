'use client';

import { useState, useTransition } from 'react';
import {
  approveDomainCandidate,
  searchDomainsForSite,
  type DomainCandidateRow,
} from './domain-actions';

interface Props {
  siteId: string;
  candidates: DomainCandidateRow[];
  registeredDomain: string | null;
}

export function DomainCandidatesPanel({ siteId, candidates, registeredDomain }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function search() {
    setMsg(null);
    startTransition(async () => {
      const r = await searchDomainsForSite(siteId);
      setMsg(r.ok ? 'Domain search enqueued. Refresh in ~1 min.' : r.message ?? 'search failed');
    });
  }

  function approve(candidateId: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await approveDomainCandidate(siteId, candidateId);
      setMsg(r.ok ? 'Approval enqueued. Domain Procurer will register.' : r.message ?? 'approve failed');
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Domain candidates</h3>
          <p className="text-xs text-slate-500 mt-1">
            Domain Procurer searches for available domains and queues them here for one-click registration.
          </p>
        </div>
        <button
          type="button"
          onClick={search}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-sky-700/40 hover:bg-sky-700/60 text-sky-200 disabled:opacity-50 whitespace-nowrap"
        >
          Search domains
        </button>
      </header>

      {registeredDomain && (
        <div className="rounded border border-emerald-700/40 bg-emerald-900/10 p-3 text-sm flex items-center gap-2">
          <span className="text-emerald-300 text-base">✓</span>
          <span className="text-slate-300">
            Registered: <span className="font-mono text-emerald-200">{registeredDomain}</span>
          </span>
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-500">
          No candidates yet. Click <strong>Search domains</strong> to dispatch the Domain Procurer.
        </div>
      ) : (
        <div className="rounded border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Rank</th>
                <th className="text-left px-3 py-2">Domain</th>
                <th className="text-left px-3 py-2">Match</th>
                <th className="text-left px-3 py-2">Price</th>
                <th className="text-left px-3 py-2">Registrar</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {candidates.map((c) => (
                <tr key={c.id} className="hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-400">{c.rank}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.domain}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{c.matchType ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {c.priceUsd != null ? `$${Number(c.priceUsd).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{c.registrar}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded border text-xs ${
                        c.status === 'pending_approval'
                          ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
                          : 'bg-slate-800/60 text-slate-300 border-slate-700'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {c.status === 'pending_approval' ? (
                      <button
                        type="button"
                        onClick={() => approve(c.id)}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
                      >
                        Approve & Register
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <p className="text-xs text-amber-300">{msg}</p>}
    </div>
  );
}
