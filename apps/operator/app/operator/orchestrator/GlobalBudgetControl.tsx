'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setGlobalCap } from './actions';

/**
 * Edits the portfolio-wide daily spend cap (system_state.globalDailyCostCapUsd)
 * from the orchestrator page. This is the FLEET-wide ceiling — it caps every
 * agent combined, not just the orchestrator. 0 disables it.
 */
export function GlobalBudgetControl({
  capUsd,
  spentTodayUsd,
}: {
  capUsd: number;
  spentTodayUsd: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(capUsd.toFixed(2));
  const [err, setErr] = useState<string | null>(null);

  const dirty = Number(value) !== capUsd;
  const pct = capUsd > 0 ? Math.min(100, Math.round((spentTodayUsd / capUsd) * 100)) : 0;
  const near = capUsd > 0 && spentTodayUsd >= capUsd * 0.8;

  function save() {
    if (pending) return;
    const usd = Number(value);
    if (!Number.isFinite(usd) || usd < 0) {
      setErr('enter a number >= 0');
      return;
    }
    setErr(null);
    startTransition(async () => {
      const r = await setGlobalCap(usd);
      if (!r.ok) setErr(r.message ?? 'failed');
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400" title="Portfolio-wide daily spend ceiling for ALL agents (not just the orchestrator). 0 disables it.">
          Global daily cap (whole fleet)
        </label>
        <span className="text-xs text-slate-500">$</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          inputMode="decimal"
          className="w-20 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-100"
        />
        <button
          onClick={save}
          disabled={pending || !dirty}
          className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-1 text-xs font-medium text-white"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className={near ? 'text-amber-300' : 'text-slate-500'}>
          spent today ${spentTodayUsd.toFixed(2)}
          {capUsd > 0 ? ` of $${capUsd.toFixed(2)} (${pct}%)` : ' (no ceiling)'}
        </span>
        {err && <span className="text-red-300">{err}</span>}
      </div>
    </div>
  );
}
