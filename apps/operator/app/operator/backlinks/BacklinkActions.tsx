'use client';

import { useState, useTransition } from 'react';
import { markSubmitted, rejectBacklink } from './actions';

export function BacklinkActions({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const r = await markSubmitted(id);
      if (!r.ok) setMsg(r.message ?? 'mark submitted failed');
    });
  }
  function reject() {
    const reason = prompt('Rejection reason (optional)');
    setMsg(null);
    startTransition(async () => {
      const r = await rejectBacklink(id, reason ?? undefined);
      if (!r.ok) setMsg(r.message ?? 'reject failed');
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="text-xs px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
      >
        Mark submitted
      </button>
      <button
        type="button"
        onClick={reject}
        disabled={pending}
        className="text-xs px-2 py-1 rounded bg-red-700/40 hover:bg-red-700/60 text-red-200 disabled:opacity-50"
      >
        Reject
      </button>
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </div>
  );
}
