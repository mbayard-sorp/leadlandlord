'use client';

import { useState, useTransition } from 'react';
import { setTheme } from './actions';

type Theme = 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';

interface Props {
  siteId: string;
  current: Theme | null;
}

const THEMES: Array<{ value: Theme; label: string; blurb: string }> = [
  { value: 'classic', label: 'Classic', blurb: 'Tradesman, "call now" — HVAC, plumbing, roofing' },
  { value: 'modern', label: 'Modern', blurb: 'Clean SaaS-y — junk removal, moving, cleaning' },
  { value: 'premium', label: 'Premium', blurb: 'Editorial, serif — landscape, remodel, fine carpentry' },
  { value: 'bright', label: 'Bright', blurb: 'Friendly, "book online" — lawn, dog walking, tutoring' },
  { value: 'haul', label: 'Haul', blurb: 'Bold, high-contrast — junk removal, hauling, demolition' },
  { value: 'counsel', label: 'Counsel', blurb: 'Editorial serif, restrained — legal lead-gen, attorneys' },
];

/**
 * Theme picker. Patches the Sanity site doc's theme reference on change —
 * the live site re-renders within Sanity-CDN-replication-lag (~5-30s) on the
 * next request. Disabled when the Sanity site doc doesn't exist yet (e.g.
 * sites built before the multi-tenant pivot).
 */
export function ThemePicker({ siteId, current }: Props) {
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<Theme | null>(current);
  const [msg, setMsg] = useState<string | null>(null);

  if (!current) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-xs text-slate-500">
        No Sanity site doc yet — theme picker activates after Site Builder writes one.
      </div>
    );
  }

  function pick(theme: Theme) {
    if (theme === active || pending) return;
    const prev = active;
    setActive(theme);
    setMsg(null);
    startTransition(async () => {
      const r = await setTheme(siteId, theme);
      if (!r.ok) {
        setActive(prev);
        setMsg(r.message ?? 'theme swap failed');
      } else {
        setMsg(`Swapped to ${theme}. Live site updates on next Sanity replication (~5-30s).`);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Theme</h3>
        <span className="text-xs text-slate-500">No redeploy — Sanity-only swap</span>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {THEMES.map((t) => {
          const isActive = active === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => pick(t.value)}
              disabled={pending}
              className={
                'text-left rounded-md border p-3 transition disabled:opacity-50 ' +
                (isActive
                  ? 'border-sky-500/70 bg-sky-900/30 text-sky-100'
                  : 'border-slate-700 bg-slate-900/30 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50')
              }
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold capitalize">{t.label}</span>
                {isActive && <span className="text-[10px] uppercase tracking-wide text-sky-300">active</span>}
              </div>
              <p className="text-xs text-slate-500 mt-1">{t.blurb}</p>
            </button>
          );
        })}
      </div>
      {msg && <p className={`text-xs ${msg.includes('failed') ? 'text-red-300' : 'text-emerald-300'}`}>{msg}</p>}
    </div>
  );
}
