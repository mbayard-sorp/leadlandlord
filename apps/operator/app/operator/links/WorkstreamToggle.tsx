'use client';

import { useState, useTransition } from 'react';
import { pauseMolly, resumeMolly } from '@/lib/links/run-actions';

interface Props {
  running: boolean;
}

export function WorkstreamToggle({ running }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggle() {
    if (!confirm && running) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    setMsg(null);
    startTransition(async () => {
      const r = running ? await pauseMolly() : await resumeMolly();
      if (!r.ok) setMsg(r.message ?? 'failed');
    });
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-amber-300">Pause all link-building agents?</span>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="text-xs px-2.5 py-1 rounded bg-amber-700/50 hover:bg-amber-700/70 text-amber-100 disabled:opacity-50"
        >
          {pending ? 'Pausing…' : 'Yes, pause'}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`text-xs px-3 py-1.5 rounded border disabled:opacity-50 ${
          running
            ? 'border-amber-700/60 bg-amber-900/30 text-amber-200 hover:bg-amber-900/50'
            : 'border-emerald-700/60 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-900/50'
        }`}
      >
        {pending ? '…' : running ? 'Pause' : 'Resume'}
      </button>
      {msg && <span className="text-xs text-red-300">{msg}</span>}
    </div>
  );
}
