'use client';

import { useState, useTransition } from 'react';
import { drainQueueNow } from './actions';

/**
 * Triggers the operator-tick dispatcher on demand so a just-queued niche
 * scout/validation runs immediately instead of waiting for the scheduled cron
 * (every ~10 minutes). Mirrors the "Drain queue now" button on the backlinks
 * prospects page.
 */
export function DrainNowButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function drain() {
    setMsg(null);
    startTransition(async () => {
      const r = await drainQueueNow();
      if (r.ok) {
        setMsg({
          ok: true,
          text: r.claimed
            ? `Drained ${r.claimed} event${r.claimed === 1 ? '' : 's'} — agent running in background…`
            : 'Queue empty — nothing to drain',
        });
      } else {
        setMsg({ ok: false, text: r.message ?? 'drain failed' });
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={drain}
        disabled={pending}
        title="Run the operator-tick dispatcher now instead of waiting for the next cron firing (~10 min)"
        className="text-xs px-3 py-1.5 rounded bg-slate-700/60 hover:bg-slate-700/80 text-slate-200 disabled:opacity-50"
      >
        {pending ? 'Draining…' : 'Drain now'}
      </button>
      <span className="text-[11px] text-slate-500">
        Queued runs start on the next cron tick (~10 min). Drain now to start immediately.
      </span>
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
