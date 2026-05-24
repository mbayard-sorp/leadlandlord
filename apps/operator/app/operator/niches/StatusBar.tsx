'use client';

import { useEffect, useState } from 'react';
import { getLatestNicheRunStatus, type NicheRunStatus } from './actions';

export function StatusBar() {
  const [status, setStatus] = useState<NicheRunStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let prevState: string | undefined;

    async function tick() {
      try {
        const s = await getLatestNicheRunStatus();
        if (cancelled) return;
        setStatus(s);
        // A fresh run should always be visible, even if the previous result
        // was dismissed.
        if (s.state === 'queued' || s.state === 'running') setDismissed(false);
        // When a run finishes, refresh the page so the new rows appear.
        if (prevState === 'running' && (s.state === 'succeeded' || s.state === 'failed')) {
          window.location.reload();
        }
        prevState = s.state;
      } catch {
        // Swallow; next tick will retry.
      }
    }

    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!status || status.state === 'idle' || dismissed) return null;

  const isTerminal =
    status.state === 'succeeded' || status.state === 'failed' || status.state === 'dead_letter';

  const { color, dot, label } = stateStyles(status.state);
  const pct = status.step && status.total ? Math.round((status.step / status.total) * 100) : null;

  return (
    <div className={`rounded-lg border ${color} p-3 text-sm`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dot} ${status.state === 'running' || status.state === 'queued' ? 'animate-pulse' : ''}`} />
        <span className="font-medium uppercase tracking-wide text-xs">{label}</span>
        {status.step && status.total && (
          <span className="text-xs text-slate-400">step {status.step}/{status.total}</span>
        )}
        <span className="text-slate-200 truncate">{status.message}</span>
        <div className="ml-auto flex items-center gap-2">
          {status.costUsd !== undefined && status.costUsd > 0 && (
            <span className="text-xs text-slate-400">${status.costUsd.toFixed(3)}</span>
          )}
          {isTerminal && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              title="Dismiss"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {status.output && (
        <div className="mt-2 text-xs text-slate-400">
          Brainstormed {status.output.brainstormed} · Scored {status.output.scored} · Saved {status.output.persisted}
        </div>
      )}
      {status.error && (
        <div className="mt-2 text-xs text-red-300 break-words">{status.error}</div>
      )}
    </div>
  );
}

function stateStyles(state: NicheRunStatus['state']) {
  switch (state) {
    case 'queued':
      return { color: 'border-amber-800 bg-amber-950/30', dot: 'bg-amber-400', label: 'Queued' };
    case 'running':
      return { color: 'border-indigo-800 bg-indigo-950/30', dot: 'bg-indigo-400', label: 'Running' };
    case 'succeeded':
      return { color: 'border-emerald-800 bg-emerald-950/30', dot: 'bg-emerald-400', label: 'Done' };
    case 'failed':
      return { color: 'border-red-800 bg-red-950/30', dot: 'bg-red-400', label: 'Failed' };
    case 'dead_letter':
      return { color: 'border-red-900 bg-red-950/40', dot: 'bg-red-500', label: 'Dead-lettered' };
    default:
      return { color: 'border-slate-800 bg-slate-900/40', dot: 'bg-slate-500', label: 'Idle' };
  }
}
