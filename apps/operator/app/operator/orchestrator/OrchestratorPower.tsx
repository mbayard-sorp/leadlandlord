'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setOrchestratorEnabled } from './actions';

/**
 * The orchestrator master switch (orchestrator Phase 6 follow-up). Flips
 * agent_budgets.enabled for 'orchestrator' — one lever that stops both the chat
 * brain and the tick-driven supervisory pass. The kill switch (operator home)
 * is the fleet-wide stop; this is the orchestrator-only one.
 */
export function OrchestratorPower({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    if (pending) return;
    setErr(null);
    startTransition(async () => {
      const r = await setOrchestratorEnabled(!enabled);
      if (!r.ok) setErr(r.message ?? 'failed');
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          enabled
            ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
            : 'bg-red-900/40 text-red-300 border border-red-800'
        }`}
      >
        <span
          className={`inline-block h-2 w-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-red-400'}`}
        />
        {enabled ? 'Orchestrator ON' : 'Orchestrator OFF'}
      </span>
      <button
        onClick={toggle}
        disabled={pending}
        className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
          enabled ? 'bg-red-700 hover:bg-red-600' : 'bg-emerald-700 hover:bg-emerald-600'
        }`}
        title={
          enabled
            ? 'Stops the chat brain and the auto-supervision pass. Reversible.'
            : 'Re-enables the orchestrator.'
        }
      >
        {pending ? '…' : enabled ? 'Turn off' : 'Turn on'}
      </button>
      {err && <span className="text-xs text-red-300">{err}</span>}
    </div>
  );
}
