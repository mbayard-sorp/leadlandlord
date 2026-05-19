'use client';

import { useState, useTransition } from 'react';
import { setAgentEnabled, setAllAgentsEnabled } from './_toggle-actions';

interface Props {
  agents: string[];
  initial: Record<string, boolean>;
}

export function AgentTogglesPanel({ agents, initial }: Props) {
  const [state, setState] = useState<Record<string, boolean>>(initial);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState<'on' | 'off' | null>(null);
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const enabledCount = agents.filter((a) => state[a] !== false).length;
  const disabledCount = agents.length - enabledCount;

  function toggle(name: string) {
    const next = !(state[name] !== false);
    setPendingName(name);
    setMsg(null);
    startTransition(async () => {
      const r = await setAgentEnabled(name, next);
      if (r.ok) setState((s) => ({ ...s, [name]: next }));
      setMsg({ ok: r.ok, text: r.message ?? '' });
      setPendingName(null);
    });
  }

  function bulk(enabled: boolean) {
    setBulkPending(enabled ? 'on' : 'off');
    setMsg(null);
    startTransition(async () => {
      const r = await setAllAgentsEnabled(enabled);
      if (r.ok) {
        const next: Record<string, boolean> = {};
        for (const a of agents) next[a] = enabled;
        setState(next);
      }
      setMsg({ ok: r.ok, text: r.message ?? '' });
      setBulkPending(null);
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Agent enablement</p>
          <p className="text-sm text-slate-300 mt-1">
            {enabledCount} enabled · {disabledCount} disabled · {agents.length} total
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Disabled agents throw AgentDisabledError on dispatch — events dead-letter, no retry storm.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => bulk(true)}
            disabled={bulkPending !== null}
            className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {bulkPending === 'on' ? 'Enabling…' : 'Enable all'}
          </button>
          <button
            type="button"
            onClick={() => bulk(false)}
            disabled={bulkPending !== null}
            className="rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {bulkPending === 'off' ? 'Disabling…' : 'Disable all'}
          </button>
        </div>
      </header>

      <div className="rounded border border-slate-800 overflow-hidden">
        <ul className="divide-y divide-slate-800">
          {agents.map((name) => {
            const enabled = state[name] !== false;
            const busy = pendingName === name || bulkPending !== null;
            return (
              <li
                key={name}
                className="flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-900/40"
              >
                <span className="font-mono">{name}</span>
                <button
                  type="button"
                  onClick={() => toggle(name)}
                  disabled={busy}
                  className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                    enabled
                      ? 'bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800/60'
                      : 'bg-red-900/60 text-red-200 hover:bg-red-800/60'
                  }`}
                  aria-pressed={enabled}
                >
                  {busy ? '…' : enabled ? 'Enabled' : 'Disabled'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
      )}
    </section>
  );
}
