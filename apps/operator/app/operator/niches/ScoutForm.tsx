'use client';

import { useState, useTransition } from 'react';
import { runNicheScout } from './actions';

const ALL_CATEGORIES = [
  { value: 'home_services', label: 'Home Services' },
  { value: 'auto', label: 'Auto' },
  { value: 'health', label: 'Health' },
  { value: 'professional', label: 'Professional' },
  { value: 'pet', label: 'Pet' },
  { value: 'event', label: 'Event' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'legal', label: 'Legal' },
  { value: 'medical', label: 'Medical' },
] as const;

/**
 * Scout phase launcher. Inputs are deliberately minimal (states, optional
 * category, population band): the engine enumerates the full trade x city
 * grid and scores from cached/static data, so there are no tuning knobs to
 * guess. Near-zero cost — only cold cluster-cache misses spend (~$0.028 per
 * uncached trade), and the cache-only toggle eliminates even that.
 */
export function ScoutForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await runNicheScout(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
    >
      <p className="md:col-span-4 text-[11px] text-slate-400 bg-slate-800/60 rounded px-3 py-2">
        <strong className="text-slate-200">Scout (near-zero cost).</strong>{' '}
        Scores the full trade × city grid for the chosen states from cached keyword clusters and
        static benchmarks, then recommends how many candidates are worth paid validation.
        Optional: Stage-3 local-SERP refinement re-scores the top-K candidates with a live
        DataForSEO call and measures real per-city SERP competition. Refinement is on by default
        (top 25); set top-K to 0 to disable.
      </p>
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        States (comma-separated, e.g. AZ,NM)
        <input
          name="states"
          defaultValue="AZ"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        />
      </label>
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        Category (optional)
        <select
          name="category_filter"
          defaultValue=""
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        >
          <option value="">All categories</option>
          {ALL_CATEGORIES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        City population min
        <input
          name="population_min"
          type="number"
          inputMode="numeric"
          defaultValue="15000"
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        />
      </label>
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        City population max
        <input
          name="population_max"
          type="number"
          inputMode="numeric"
          defaultValue="150000"
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        />
      </label>
      <label className="md:col-span-3 flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
        <input
          type="checkbox"
          name="warm_missing_clusters"
          value="true"
          defaultChecked
          className="h-4 w-4 rounded border border-slate-600 bg-slate-950 accent-emerald-500"
        />
        Warm missing keyword clusters (~$0.028 per uncached trade; first fully cold run can cost up
        to ~$12.50, then ~$0). Uncheck for a strictly cache-only scout.
      </label>

      {/* Stage-3 local-SERP refinement controls */}
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        Refine top-K candidates
        <input
          name="refine_top_k"
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          defaultValue=""
          placeholder="25 (default)"
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        />
        <span className="text-[10px] text-slate-500">
          Re-scores the top-K cells via live DataForSEO local SERP. Empty = system default (25). Set 0 to disable.
        </span>
      </label>
      <label className="text-xs text-slate-400 flex flex-col gap-1">
        Refine budget (USD)
        <input
          name="refine_budget_usd"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          defaultValue=""
          placeholder="3.00 (default)"
          className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
        />
        <span className="text-[10px] text-slate-500">
          DataForSEO spend cap for this refinement pass. Empty = use system default ($3.00).
        </span>
      </label>
      <label className="md:col-span-2 flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
        <input
          type="checkbox"
          name="refine_measure_volume"
          value="true"
          className="h-4 w-4 rounded border border-slate-600 bg-slate-950 accent-emerald-500"
        />
        Measure local volume during refinement (adds ~$0.001 per cell; empty system default = off).
      </label>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center min-h-[44px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-sm font-medium text-white"
      >
        {pending ? 'Queuing…' : 'Run Scout'}
      </button>
      {msg && (
        <p className={`md:col-span-4 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
