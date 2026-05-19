'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePolledFetch } from '../../../../lib/use-polled-fetch';
import {
  addGscVerificationTxt,
  addManualCandidate,
  approveDomainCandidate,
  checkDomainAvailability,
  searchDomainsForSite,
  type DomainCandidateRow,
  type ManualCheckResult,
} from './domain-actions';

interface PolledResponse {
  ok: true;
  searching: boolean;
  lastError: string | null;
  registeredDomain: string | null;
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

export function DomainCandidatesPanel({ siteId, candidates: initial, registeredDomain: initialRegistered }: Props) {
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
  const registeredDomain = data?.registeredDomain ?? initialRegistered;

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
      if (data.registeredDomain && !initialRegistered) {
        setMsg(`Registered ${data.registeredDomain}.`);
      } else if (data.lastError) {
        setMsg(`Domain Procurer failed: ${data.lastError}`);
      } else if (data.candidates.length > 0) {
        setMsg(
          `Found ${data.candidates.length} candidate${data.candidates.length === 1 ? '' : 's'}.`,
        );
      } else {
        setMsg('No candidates found.');
      }
    }
  }, [data, pollEnabled, pollStartedAt, initialRegistered]);

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
      if (r.ok) {
        setMsg('Approval enqueued. Registering…');
        // Poll until the candidate flips to 'registered' (or the timeout
        // hits). Same poll loop as the initial search uses.
        setPollStartedAt(Date.now());
        setPollEnabled(true);
      } else {
        setMsg(r.message ?? 'approve failed');
      }
    });
  }

  const [manualDomain, setManualDomain] = useState('');
  const [manualCheck, setManualCheck] = useState<ManualCheckResult | null>(null);
  const [manualPending, setManualPending] = useState(false);

  async function check() {
    if (!manualDomain.trim() || manualPending) return;
    setManualCheck(null);
    setManualPending(true);
    try {
      const r = await checkDomainAvailability(manualDomain);
      setManualCheck(r);
    } finally {
      setManualPending(false);
    }
  }

  function addManual() {
    if (!manualCheck?.domain || !manualCheck.available) return;
    const target = manualCheck.domain;
    startTransition(async () => {
      const r = await addManualCandidate(siteId, target);
      if (r.ok) {
        setMsg(`Added ${target} to candidates.`);
        setManualDomain('');
        setManualCheck(null);
      } else {
        setMsg(r.message ?? 'add failed');
      }
    });
  }

  const [gscToken, setGscToken] = useState('');
  const [gscPending, setGscPending] = useState(false);

  function submitGsc() {
    if (!gscToken.trim() || gscPending || !registeredDomain) return;
    setGscPending(true);
    setMsg(null);
    (async () => {
      try {
        const r = await addGscVerificationTxt(siteId, gscToken);
        if (r.ok) {
          setMsg(`GSC TXT written. Click "Verify" in Search Console now.`);
          setGscToken('');
        } else {
          setMsg(r.message ?? 'GSC TXT write failed');
        }
      } finally {
        setGscPending(false);
      }
    })();
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

      <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Check a specific domain
          </h4>
          <span className="text-[10px] text-slate-500">manual lookup</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualDomain}
            onChange={(e) => setManualDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                check();
              }
            }}
            placeholder="e.g. junkremovalsanangelo.com"
            disabled={manualPending}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={check}
            disabled={manualPending || !manualDomain.trim()}
            className="text-xs px-3 py-1.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-200 disabled:opacity-50 whitespace-nowrap"
          >
            {manualPending ? 'Checking…' : 'Check'}
          </button>
        </div>
        {manualCheck && (
          <div className="flex items-center justify-between gap-3 text-xs">
            {manualCheck.ok ? (
              <>
                <span className="font-mono text-slate-300">{manualCheck.domain}</span>
                {manualCheck.available ? (
                  <span className="flex items-center gap-3">
                    <span className="text-emerald-300">
                      ✓ available
                      {manualCheck.priceUsd != null && ` · $${manualCheck.priceUsd.toFixed(2)}`}
                    </span>
                    <button
                      type="button"
                      onClick={addManual}
                      disabled={pending}
                      className="px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
                    >
                      Add to candidates
                    </button>
                  </span>
                ) : (
                  <span className="text-slate-500">taken</span>
                )}
              </>
            ) : (
              <span className="text-amber-300">{manualCheck.message ?? 'check failed'}</span>
            )}
          </div>
        )}
      </div>

      {registeredDomain && (
        <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Google Search Console
            </h4>
            <a
              href={`https://search.google.com/search-console/welcome?domain=${encodeURIComponent(registeredDomain)}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-sky-300 hover:text-sky-200 underline"
            >
              Open GSC →
            </a>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Add <span className="font-mono text-slate-400">{registeredDomain}</span> as a Domain property in GSC,
            copy the TXT verification value, paste it below, then click Verify in GSC.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={gscToken}
              onChange={(e) => setGscToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitGsc();
                }
              }}
              placeholder="google-site-verification=…"
              disabled={gscPending}
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submitGsc}
              disabled={gscPending || !gscToken.trim()}
              className="text-xs px-3 py-1.5 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-200 disabled:opacity-50 whitespace-nowrap"
            >
              {gscPending ? 'Writing…' : 'Add TXT record'}
            </button>
          </div>
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
