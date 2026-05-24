'use client';

import { useState, useTransition } from 'react';
import { seedAndValidateNiche } from './actions';

export function SeedNicheForm() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await seedAndValidateNiche(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
    >
      <div className="md:col-span-3">
        <h2 className="text-sm font-semibold text-slate-200">Test a specific niche</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Have a city + service in mind? Seed it and run live DataForSEO validation in one step.
        </p>
      </div>
      <Field label="Service / niche" name="niche" placeholder="tree removal" />
      <Field label="City" name="city" placeholder="Tucson" />
      <Field label="State (2-letter)" name="state" placeholder="AZ" />
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[44px] rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-4 text-sm font-medium text-white w-full"
        >
          {pending ? 'Validating…' : 'Seed + validate'}
        </button>
      </div>
      {msg && (
        <p className={`md:col-span-3 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  placeholder,
}: {
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <label className="text-xs text-slate-400 flex flex-col gap-1">
      <span>{label}</span>
      <input
        name={name}
        placeholder={placeholder}
        type="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="rounded bg-slate-950 border border-slate-700 px-2 min-h-[44px] text-sm text-slate-100 placeholder:text-slate-600"
      />
    </label>
  );
}
