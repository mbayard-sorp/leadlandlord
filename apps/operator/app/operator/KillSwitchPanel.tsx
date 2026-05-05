'use client';

import { useState, useTransition } from 'react';
import type { SystemState } from '@leadlandlord/db';
import { activateKillSwitch, deactivateKillSwitch } from './_kill-switch-actions';

interface Props {
  state: SystemState;
}

/**
 * Operator-only kill switch. When active, every agent's BaseAgent.run()
 * throws KillSwitchActiveError before doing any work. Use when something is
 * burning money or sending bad messages and you need to stop everything in
 * one click.
 */
export function KillSwitchPanel({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onActivate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await activateKillSwitch(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
      if (r.ok) setReason('');
    });
  }

  function onDeactivate() {
    setMsg(null);
    startTransition(async () => {
      const r = await deactivateKillSwitch();
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  if (state.killSwitch) {
    return (
      <section className="rounded-lg border border-red-800 bg-red-950/40 p-4 space-y-3">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-300">Kill switch</p>
            <p className="text-lg font-semibold text-red-200 mt-1">ACTIVE — all agents paused</p>
          </div>
        </header>
        <dl className="text-sm space-y-1 text-red-100/80">
          {state.killSwitchReason ? (
            <div>
              <dt className="inline text-red-300/70">Reason: </dt>
              <dd className="inline">{state.killSwitchReason}</dd>
            </div>
          ) : null}
          {state.killSwitchActivatedAt ? (
            <div>
              <dt className="inline text-red-300/70">Activated: </dt>
              <dd className="inline">
                {new Date(state.killSwitchActivatedAt).toLocaleString()}
              </dd>
            </div>
          ) : null}
          {state.killSwitchActivatedBy ? (
            <div>
              <dt className="inline text-red-300/70">By: </dt>
              <dd className="inline">{state.killSwitchActivatedBy}</dd>
            </div>
          ) : null}
        </dl>
        <button
          type="button"
          onClick={onDeactivate}
          disabled={pending}
          className="rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
        >
          {pending ? 'Deactivating…' : 'Deactivate kill switch'}
        </button>
        {msg && (
          <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Kill switch</p>
        <p className="text-sm text-slate-300 mt-1">
          Inactive. All agents run normally.
        </p>
      </header>
      <form onSubmit={onActivate} className="space-y-2">
        <label className="block text-xs text-slate-400">
          Reason (logged + shown on /operator)
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            placeholder="runaway spend / broken integration / etc."
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !reason.trim()}
          className="rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
        >
          {pending ? 'Activating…' : 'STOP EVERYTHING — activate kill switch'}
        </button>
        {msg && (
          <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
        )}
      </form>
    </section>
  );
}
