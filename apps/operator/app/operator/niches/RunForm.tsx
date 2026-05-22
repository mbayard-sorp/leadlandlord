'use client';

import { useEffect, useState, useTransition } from 'react';
import { runNicheHunter } from './actions';

// Static fallback defaults — used on first load before any saved config exists.
const STATIC_DEFAULTS: Record<string, string> = {
  states: 'AZ,NM,TX,NV',
  target_count: '10',
  brainstorm_count: '30',
  score_top_n: '8',
  min_search_volume: '100',
  max_kd: '60',
  min_avg_job_value_usd: '150',
  city_pool_size: '150',
  per_state_cap: '12',
  city_population_min: '',
  city_population_max: '',
};

const ALL_CATEGORIES = [
  { value: 'home_services', label: 'Home Services' },
  { value: 'auto',          label: 'Auto' },
  { value: 'health',        label: 'Health' },
  { value: 'professional',  label: 'Professional' },
  { value: 'pet',           label: 'Pet' },
  { value: 'event',         label: 'Event' },
  { value: 'lifestyle',     label: 'Lifestyle' },
] as const;

const STORAGE_KEY = 'niche-hunter:last-config:v1';

function loadSavedConfig(): Record<string, string> {
  if (typeof window === 'undefined') return STATIC_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return STATIC_DEFAULTS;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...STATIC_DEFAULTS, ...parsed };
  } catch {
    return STATIC_DEFAULTS;
  }
}

export function RunForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Render with static defaults on the server + first client render to avoid
  // a hydration mismatch, then hydrate from localStorage in an effect. Bumping
  // `formKey` after hydration forces uncontrolled inputs to re-pick defaultValue.
  const [defaults, setDefaults] = useState<Record<string, string>>(STATIC_DEFAULTS);
  const [formKey, setFormKey] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadSavedConfig();
    if (loaded !== STATIC_DEFAULTS) {
      setDefaults(loaded);
      setFormKey((k) => k + 1);
      try {
        const stamp = window.localStorage.getItem(`${STORAGE_KEY}:savedAt`);
        if (stamp) setSavedAt(stamp);
      } catch {
        // ignore
      }
    }
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    // Persist the submitted values so the next visit pre-fills them.
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of fd.entries()) if (typeof v === 'string') obj[k] = v;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      const now = new Date().toISOString();
      window.localStorage.setItem(`${STORAGE_KEY}:savedAt`, now);
      setSavedAt(now);
    } catch {
      // localStorage may be blocked (private mode, quota); not fatal.
    }
    startTransition(async () => {
      const r = await runNicheHunter(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  function resetDefaults() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(`${STORAGE_KEY}:savedAt`);
    } catch {
      // ignore
    }
    setDefaults(STATIC_DEFAULTS);
    setFormKey((k) => k + 1);
    setSavedAt(null);
  }

  return (
    <form
      key={formKey}
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
    >
      <p className="md:col-span-3 text-[11px] text-slate-400 bg-slate-800/60 rounded px-3 py-2">
        <strong className="text-slate-200">Estimate-only mode (no DataForSEO spend).</strong>{' '}
        Scoring uses Claude&apos;s brainstorm-time volume and confidence estimates. Validate individual rows on demand after reviewing results.
      </p>
      <div className="md:col-span-3 flex flex-col gap-1.5">
        <span className="text-xs text-slate-400">Categories (default: all)</span>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {ALL_CATEGORIES.map(({ value, label }) => (
            <label key={value} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                name="allowed_categories"
                value={value}
                defaultChecked
                className="h-4 w-4 rounded border border-slate-600 bg-slate-950 accent-emerald-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <Field
        label="States (comma-separated, e.g. AZ,NM)"
        name="states"
        defaultValue={defaults.states}
        tooltip="Restrict the pre-ranked city pool to these two-letter state codes. Leave blank to pull from all 50 states. Cities are still capped at 12 per state for network diversity."
      />
      <Field
        label="Target count"
        name="target_count"
        defaultValue={defaults.target_count}
        type="number"
        tooltip="Maximum number of niche+city candidates to save after scoring and threshold filtering. The top N by composite score are kept."
      />
      <Field
        label="Brainstorm count"
        name="brainstorm_count"
        defaultValue={defaults.brainstorm_count}
        type="number"
        tooltip="How many candidates Claude generates before funnel + DataForSEO scoring. Brainstorm is cheap; widen this freely. Spend is gated by 'Score top N' below."
      />
      <Field
        label="Score top N"
        name="score_top_n"
        defaultValue={defaults.score_top_n}
        type="number"
        tooltip="After brainstorming, Claude self-ranks candidates by confidence_score. In estimate-only mode (the default) this controls how many rows are saved — no DFS spend regardless of value. In full-DFS mode each scored candidate costs ~$0.225 (3 endpoint calls)."
      />
      <Field
        label="Min search volume / mo"
        name="min_search_volume"
        defaultValue={defaults.min_search_volume}
        type="number"
        tooltip="Min monthly demand to keep a candidate. We use DataForSEO Google Ads volume when it's ≥100 (trustworthy); otherwise we fall back to Claude's brainstorm-time estimate (mid of low/high range), which is more accurate for hyperlocal long-tail. Filter applies to the resolved value."
      />
      <Field
        label="Max SERP difficulty (0-100)"
        name="max_kd"
        defaultValue={defaults.max_kd}
        type="number"
        tooltip="Derived from SERP composition: aggregator-share × 70 + (no local pack ? 30 : 0). 0-30 = mostly small-biz SERP with local pack (winnable). 30-60 = mixed. 60+ = dominated by Yelp/Angie/HomeAdvisor or no local intent (drop). Stored in the kd column."
      />
      <Field
        label="Min avg job value (USD)"
        name="min_avg_job_value_usd"
        defaultValue={defaults.min_avg_job_value_usd}
        type="number"
        tooltip="Minimum average revenue per closed job (Claude's estimate). Filters out low-ticket niches that can't support a tenant paying us monthly."
      />
      <Field
        label="City pool size"
        name="city_pool_size"
        defaultValue={defaults.city_pool_size}
        type="number"
        tooltip="How many cities are sent to Claude as the brainstorm whitelist. Higher = more variety but larger prompt. Default 150."
      />
      <Field
        label="Per-state cap"
        name="per_state_cap"
        defaultValue={defaults.per_state_cap}
        type="number"
        tooltip="Max cities per state in the pool. Diversity constraint so one state can't dominate. Default 12 (ranker-only; ignored when population range is set)."
      />
      <Field
        label="City pop min (optional)"
        name="city_population_min"
        defaultValue={defaults.city_population_min}
        type="number"
        tooltip="Override: random-sample cities ≥ this population. Setting either pop-min or pop-max bypasses the default 20k–110k small-city ranker. Leave blank to use the ranker."
      />
      <Field
        label="City pop max (optional)"
        name="city_population_max"
        defaultValue={defaults.city_population_max}
        type="number"
        tooltip="Override: random-sample cities ≤ this population. Use ~250k to chase higher volumes; expect more aggregator SERP competition. Leave blank to use the ranker."
      />
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[44px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-sm font-medium text-white flex-1"
        >
          {pending ? 'Running…' : 'Run Niche Hunter'}
        </button>
        {savedAt && (
          <button
            type="button"
            onClick={resetDefaults}
            title="Clear saved config and restore static defaults"
            className="inline-flex items-center justify-center min-h-[44px] rounded border border-slate-700 hover:border-slate-500 px-3 text-xs text-slate-300"
          >
            Reset
          </button>
        )}
      </div>
      {savedAt && (
        <p className="md:col-span-3 text-[11px] text-slate-500">
          Using saved config from {new Date(savedAt).toLocaleString()}. Submitting saves the current values for next time.
        </p>
      )}
      {msg && (
        <p
          className={`md:col-span-3 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  tooltip,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  tooltip?: string;
}) {
  const inputModeAttr = type === 'number' ? 'numeric' : undefined;
  return (
    <label className="text-xs text-slate-400 flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        {label}
        {tooltip && (
          <span className="group relative inline-flex">
            <span
              aria-label={tooltip}
              tabIndex={0}
              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-600 text-[10px] font-semibold text-slate-400 hover:border-slate-400 hover:text-slate-200 focus:outline-none focus:border-slate-400 focus:text-slate-200"
            >
              i
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-64 -translate-x-1/2 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-normal leading-snug text-slate-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100! group-focus-within:opacity-100!"
            >
              {tooltip}
            </span>
          </span>
        )}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        type={type}
        inputMode={inputModeAttr}
        autoCapitalize={type === 'text' ? 'characters' : 'off'}
        autoCorrect="off"
        spellCheck={false}
        className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100"
      />
    </label>
  );
}
