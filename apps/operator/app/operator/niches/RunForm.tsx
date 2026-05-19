'use client';

import { useState, useTransition } from 'react';
import { runNicheHunter } from './actions';

export function RunForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await runNicheHunter(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
    >
      <Field
        label="States (comma-separated, e.g. AZ,NM)"
        name="states"
        defaultValue="AZ,NM,TX,NV"
        tooltip="Restrict the pre-ranked city pool to these two-letter state codes. Leave blank to pull from all 50 states. Cities are still capped at 12 per state for network diversity."
      />
      <Field
        label="Target count"
        name="target_count"
        defaultValue="10"
        type="number"
        tooltip="Maximum number of niche+city candidates to save after scoring and threshold filtering. The top N by composite score are kept."
      />
      <Field
        label="Brainstorm count"
        name="brainstorm_count"
        defaultValue="30"
        type="number"
        tooltip="How many candidates Claude generates before DataForSEO scoring. Higher = more variety but more DataForSEO spend (1 keyword call + 1 ad-count call per candidate)."
      />
      <Field
        label="Min search volume / mo"
        name="min_search_volume"
        defaultValue="100"
        type="number"
        tooltip="Drop any candidate whose summed monthly Google search volume (across 3 keyword variants) falls below this number. Filters out dead markets."
      />
      <Field
        label="Max KD (0-100)"
        name="max_kd"
        defaultValue="40"
        type="number"
        tooltip="Maximum keyword difficulty. Lower = easier to rank. 0–30 is very easy, 30–50 moderate, 50+ hard. Candidates above this are dropped."
      />
      <Field
        label="Min avg job value (USD)"
        name="min_avg_job_value_usd"
        defaultValue="150"
        type="number"
        tooltip="Minimum average revenue per closed job (Claude's estimate). Filters out low-ticket niches that can't support a tenant paying us monthly."
      />
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[44px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-sm font-medium text-white w-full"
        >
          {pending ? 'Running…' : 'Run Niche Hunter'}
        </button>
      </div>
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
