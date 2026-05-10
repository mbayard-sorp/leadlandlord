'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePolledFetch } from '../../../../lib/use-polled-fetch';
import {
  approveDomainCandidate,
  searchDomainsForSite,
  type DomainCandidateRow,
} from './domain-actions';

interface PolledResponse {
  ok: true;
  searching: boolean;
  lastError: string | null;
  candidates: Array<{
    id: string;
    domain: string;
    rank: number | null;
    matchType: string | null;
    priceUsd: string | null;
    registrar: string;
    status: DomainCandidateRow['status'];
  }>;
}

interface Props {
  siteId: string;
  candidates: DomainCandidateRow[];
  registeredDomain: string | null;
}

const POLL_MS = 3000;
// Hard cap so we don't poll forever if the agent crashes silently.
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

export function DomainCandidatesPanel({ siteId, candidates: initial, registeredDomain }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);

  const { data } = usePolledFetch<PolledResponse>(
    `/api/operator/sites/${siteId}/domain-candidates`,
    { intervalMs: POLL_MS, enabled: pollEnabled },
  );

  // Server-rendered initial list; once polling starts, the live list takes over.
  const candidates = data?.candidates ?? initial;
  const searching = data?.searching ?? false;

  // Start polling when the operator clicks Search; stop once the agent finishes
  // (searching=false), regardless of whether candidates were found. A finished
  // run with zero candidates is either a real "no available domains" outcome
  // or an agent failure — `lastError` distinguishes those. Also stops on a
  // hard timeout so we don't drain the dev server forever.
  useEffect(() => {
    if (!pollEnabled || pollStartedAt == null || !data) return;
    const elapsed = Date.now() - pollStartedAt;
    if (elapsed > MAX_POLL_DURATION_MS) {
      setPollEnabled(false);
      setMsg('Search timed out. Refresh to see latest state.');
      return;
    }
    if (!data.searching) {
      setPollEnabled(false);
      if (data.candidates.length > 0) {
        setMsg(
          `Found ${data.candidates.length} candidate${data.candidates.length === 1 ? '' : 's'}.`,
        );
      } else if (data.lastError) {
        setMsg(`Domain Procurer failed: ${data.lastError}`);
      } else {
        setMsg('No candidates found.');
      }
    }
  }, [data, pollEnabled, pollStartedAt]);

  function search() {
    setMsg(null);
    startTransition(async () => {
      const r = await searchDomainsForSite(siteId);
      if (r.ok) {
        setPollStartedAt(Date.now());
        setPollEnabled(true);
        setMsg('Searching domains…');
      } else {
        setMsg(r.message ?? 'search failed');
      }
    });
  }

  function approve(candidateId: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await approveDomainCandidate(siteId, candidateId);
      setMsg(r.ok ? 'Approval enqueued. Domain Procurer will register.' : r.message ?? 'approve failed');
    });
  }

  const showSpinner = pending || pollEnabled || searching;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            Domain candidates
            {showSpinner && <Spinner />}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {showSpinner && pollEnabled
              ? 'Domain Procurer is searching… results stream in below.'
              : 'Domain Procurer searches for available domains and queues them here for one-click registration.'}
          </p>
        </div>
        <button
          type="button"
          onClick={search}
          disabled={pending || pollEnabled}
          className="text-xs px-3 py-1.5 rounded bg-sky-700/40 hover:bg-sky-700/60 text-sky-200 disabled:opacity-50 whitespace-nowrap"
        >
          {pollEnabled ? 'Searching…' : 'Search domains'}
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
          {pollEnabled
            ? 'Waiting for the first results…'
            : (
              <>No candidates yet. Click <strong>Search domains</strong> to dispatch the Domain Procurer.</>
            )}
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

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5 text-sky-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
