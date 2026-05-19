'use client';

import { useTransition, useState } from 'react';
import { createWave } from '../actions';

interface SiteOption {
  id: string;
  domain: string | null;
  niche: string;
  city: string;
  state: string;
  status: string;
}

interface Props {
  sites: SiteOption[];
}

export function WaveNewForm({ sites }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSite(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // clear existing site_ids from form and re-append from controlled state
    // (checkboxes are included via the native form; selected state mirrors them)
    startTransition(async () => {
      const result = await createWave(fd);
      if (result && !result.ok) {
        setError(result.message ?? 'unknown error');
      }
    });
  }

  const selCount = selected.size;
  const selValid = selCount >= 3 && selCount <= 5;

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-xl">
      {error && (
        <div className="rounded border border-rose-700/50 bg-rose-900/20 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="name" className="block text-sm text-slate-300">
          Wave name <span className="text-rose-400">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="e.g. Plumbers Southwest Wave 1"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="niche" className="block text-sm text-slate-300">
          Niche <span className="text-rose-400">*</span>
        </label>
        <input
          id="niche"
          name="niche"
          type="text"
          required
          placeholder="e.g. plumber"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-300">
            Sites <span className="text-rose-400">*</span>
          </span>
          <span className={`text-xs ${selValid ? 'text-emerald-400' : 'text-slate-500'}`}>
            {selCount} selected (3–5 required)
          </span>
        </div>

        {sites.length === 0 ? (
          <p className="text-sm text-slate-500">
            No eligible sites found (warming/live/rented).
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded border border-slate-700 divide-y divide-slate-800">
            {sites.map((s) => {
              const checked = selected.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-800/60 ${checked ? 'bg-indigo-900/20' : ''}`}
                >
                  <input
                    type="checkbox"
                    name="site_ids"
                    value={s.id}
                    checked={checked}
                    onChange={() => toggleSite(s.id)}
                    className="accent-indigo-500"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-200 truncate">
                      {s.domain ?? s.id}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {s.niche} — {s.city}, {s.state} &middot; {s.status}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={pending || !selValid}
        className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded"
      >
        {pending ? 'Creating...' : 'Create wave'}
      </button>
    </form>
  );
}
