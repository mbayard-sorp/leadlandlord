'use client';

import { useState, useTransition } from 'react';
import type { SystemState } from '@leadlandlord/db';
import {
  updateOperatorTargets,
  updateOperatorMode,
  setOperatorEnabled,
  updateScoringPriors,
} from './_actions';

interface Props {
  state: SystemState;
}

type Msg = { ok: boolean; text: string } | null;

/**
 * Operator Control panel forms. Three independent sections:
 *  1. Master enable toggle + heartbeat.
 *  2. Mode selector (manual | supervised | autonomous).
 *  3. Targets editor (MRR, sites, margin, auto-approve gates).
 */
export function ControlForms({ state }: Props) {
  return (
    <div className="space-y-8">
      <EnabledSection state={state} />
      <ModeSection state={state} />
      <TargetsSection state={state} />
      <ScoringPriorsSection state={state} />
    </div>
  );
}

function EnabledSection({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function flip(enabled: boolean) {
    setMsg(null);
    const fd = new FormData();
    fd.set('enabled', enabled ? 'on' : '');
    startTransition(async () => {
      const r = await setOperatorEnabled(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Master switch</p>
          <p
            className={
              state.operatorEnabled
                ? 'text-lg font-semibold text-emerald-300 mt-1'
                : 'text-lg font-semibold text-slate-300 mt-1'
            }
          >
            {state.operatorEnabled ? 'ENABLED — operator runs every 10 min' : 'DISABLED'}
          </p>
          {state.lastOperatorRunAt ? (
            <p className="text-xs text-slate-500 mt-1">
              Last run {new Date(state.lastOperatorRunAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">Never run</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => flip(!state.operatorEnabled)}
          disabled={pending}
          className={
            state.operatorEnabled
              ? 'rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white'
              : 'rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white'
          }
        >
          {pending ? '…' : state.operatorEnabled ? 'Disable operator' : 'Enable operator'}
        </button>
      </header>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  );
}

function ModeSection({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [mode, setMode] = useState(state.operatorMode);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateOperatorMode(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Mode</p>
        <p className="text-sm text-slate-300 mt-1">
          <span className="text-slate-500">manual</span> — read state only, never dispatch.
          {' '}
          <span className="text-slate-500">supervised</span> — dispatch domain searches but never
          auto-approve.
          {' '}
          <span className="text-slate-500">autonomous</span> — full decision tree.
        </p>
      </header>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-slate-400">
          Operator mode
          <select
            name="operatorMode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="mt-1 block w-full sm:w-48 rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          >
            <option value="manual">manual</option>
            <option value="supervised">supervised</option>
            <option value="autonomous">autonomous</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || mode === state.operatorMode}
          className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white"
        >
          {pending ? 'Saving…' : 'Save mode'}
        </button>
      </form>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  );
}

function ScoringPriorsSection({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateScoringPriors(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Niche-scoring priors</p>
        <p className="text-sm text-slate-400 mt-1">
          Tuning knobs read by <code className="text-slate-300">validateNiche</code>. Leave a field
          blank to use the built-in default. Changes apply to the next validation only — they do
          not rescore existing rows.
        </p>
      </header>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs text-slate-400">
          Geo-share prior (fraction, default 0.15)
          <input
            type="number"
            min="0"
            max="1"
            step="0.001"
            name="geoSharePrior"
            defaultValue={state.geoSharePrior ?? ''}
            placeholder="0.15"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Rentability CPC ceiling (USD, default 12)
          <input
            type="number"
            min="0"
            step="0.01"
            name="rentabilityCpcCeiling"
            defaultValue={state.rentabilityCpcCeiling ?? ''}
            placeholder="12"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Rentability lead-price ceiling (USD, default 100)
          <input
            type="number"
            min="0"
            step="0.01"
            name="rentabilityLeadPriceCeiling"
            defaultValue={state.rentabilityLeadPriceCeiling ?? ''}
            placeholder="100"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white"
          >
            {pending ? 'Saving…' : 'Save priors'}
          </button>
          {msg && (
            <span className={`ml-3 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function TargetsSection({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set('autoApproveNiches', e.currentTarget.autoApproveNiches.checked ? 'on' : '');
    startTransition(async () => {
      const r = await updateOperatorTargets(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Targets &amp; autonomy gates</p>
        <p className="text-sm text-slate-400 mt-1">
          These set the goals the operator agent reads on each tick. Auto-approve toggles
          only fire in <code className="text-slate-300">autonomous</code> mode.
        </p>
      </header>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-xs text-slate-400">
          Target MRR (USD)
          <input
            type="number"
            min="0"
            step="0.01"
            name="targetMrrUsd"
            defaultValue={Number(state.targetMrrUsd)}
            required
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Target active sites
          <input
            type="number"
            min="0"
            step="1"
            name="targetActiveSites"
            defaultValue={state.targetActiveSites}
            required
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Target monthly margin (0.30 = 30%)
          <input
            type="number"
            min="-1"
            max="1"
            step="0.01"
            name="targetMonthlyMargin"
            defaultValue={Number(state.targetMonthlyMargin)}
            required
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Auto-approve domain budget (USD per domain)
          <input
            type="number"
            min="0"
            step="0.01"
            name="autoApproveDomainBudgetUsd"
            defaultValue={Number(state.autoApproveDomainBudgetUsd)}
            required
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
        </label>
        <label className="md:col-span-2 inline-flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            name="autoApproveNiches"
            defaultChecked={state.autoApproveNiches}
            className="h-4 w-4 rounded bg-slate-950 border-slate-700"
          />
          Auto-approve high-scoring niches (score ≥ 75) — autonomous only
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white"
          >
            {pending ? 'Saving…' : 'Save targets'}
          </button>
          {msg && (
            <span className={`ml-3 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
