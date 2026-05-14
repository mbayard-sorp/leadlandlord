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
      <Field label="States (comma-separated, e.g. AZ,NM)" name="states" defaultValue="AZ,NM,TX,NV" />
      <Field label="Target count" name="target_count" defaultValue="10" type="number" />
      <Field label="Brainstorm count" name="brainstorm_count" defaultValue="30" type="number" />
      <Field label="Min search volume / mo" name="min_search_volume" defaultValue="100" type="number" />
      <Field label="Max KD (0-100)" name="max_kd" defaultValue="40" type="number" />
      <Field label="Min avg job value (USD)" name="min_avg_job_value_usd" defaultValue="150" type="number" />
      <Field label="City pop min (optional)" name="population_min" type="number" />
      <Field label="City pop max (optional)" name="population_max" type="number" />
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
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
}) {
  const inputModeAttr = type === 'number' ? 'numeric' : undefined;
  return (
    <label className="text-xs text-slate-400 flex flex-col gap-1">
      {label}
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
