'use client';

import { useState, useTransition } from 'react';
import { runProspectForSite } from '../actions';

interface SiteOption {
  id: string;
  label: string;
  hasCompetitorSeeds: boolean;
}

/**
 * Operator-facing trigger for a Backlink Builder prospect run. The user
 * selects a site, optionally pastes competitor domains as a per-call
 * override, and fires the agent. Apollo cap is enforced server-side; the
 * UI shows the resulting discovered/enriched/created counts.
 */
export function ProspectRunner({ sites }: { sites: SiteOption[] }) {
  const [siteId, setSiteId] = useState<string>(sites[0]?.id ?? '');
  const [override, setOverride] = useState<string>('');
  const [maxApollo, setMaxApollo] = useState<number>(5);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  function run() {
    setResult(null);
    if (!siteId) {
      setResult({ ok: false, msg: 'pick a site first' });
      return;
    }
    const competitors = override
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const selectedSite = sites.find((s) => s.id === siteId);
    if (
      competitors.length === 0 &&
      selectedSite &&
      !selectedSite.hasCompetitorSeeds
    ) {
      setResult({
        ok: false,
        msg:
          'No competitors. This site has no stored seeds — paste 2+ competitor domains in the textarea (commas, spaces, or newlines).',
      });
      return;
    }
    startTransition(async () => {
      const r = await runProspectForSite({
        siteId,
        competitorOverride: competitors.length > 0 ? competitors : undefined,
        maxApolloEnrichments: maxApollo,
      });
      if (!r.ok) {
        setResult({ ok: false, msg: r.message ?? 'run failed' });
        return;
      }
      setResult({
        ok: true,
        msg: `discovered ${r.discovered ?? 0}, enriched ${r.enriched ?? 0}, created ${r.created ?? 0} (sent ${competitors.length} competitors)`,
      });
    });
  }

  const selected = sites.find((s) => s.id === siteId);
  const needsOverride = selected != null && !selected.hasCompetitorSeeds;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-200">Run prospecting</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs text-slate-400 space-y-1">
          <span>Site</span>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="block w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200"
          >
            {sites.length === 0 ? <option value="">— no sites —</option> : null}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.hasCompetitorSeeds ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 space-y-1">
          <span>
            Max Apollo enrichments{' '}
            <span className="text-slate-500">(burns 1 free credit each)</span>
          </span>
          <input
            type="number"
            min={1}
            max={75}
            value={maxApollo}
            onChange={(e) => setMaxApollo(Math.max(1, Math.min(75, Number(e.target.value) || 1)))}
            className="block w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={run}
            disabled={pending || !siteId}
            className="text-xs px-3 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700/80 text-sky-100 disabled:opacity-50"
          >
            {pending ? 'Running…' : 'Run prospect mode'}
          </button>
        </div>
      </div>

      <label className="text-xs text-slate-400 space-y-1 block">
        <span>
          Competitor domains (override){' '}
          {needsOverride ? (
            <span className="text-amber-400">— required, no seeds stored on this site</span>
          ) : (
            <span className="text-slate-500">— optional, comma or whitespace separated</span>
          )}
        </span>
        <textarea
          rows={2}
          placeholder="competitor-a.com, competitor-b.com"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          className="block w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200 font-mono"
        />
      </label>

      {result && (
        <div
          className={`text-xs ${
            result.ok ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          {result.msg}
        </div>
      )}
    </div>
  );
}
