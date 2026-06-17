'use client';

import { useState, useTransition } from 'react';
import type { SystemState } from '@leadlandlord/db';
import { Timestamp } from '../../../components/Timestamp';
import {
  updateOperatorTargets,
  updateOperatorMode,
  setOperatorEnabled,
  updateScoringPriors,
  updateScoutGeoKnobs,
  updateOperatorTimeZone,
} from './_actions';

interface Props {
  state: SystemState;
}

type Msg = { ok: boolean; text: string } | null;

/**
 * Operator Control panel forms. Independent sections:
 *  1. Master enable toggle + heartbeat.
 *  2. Mode selector (manual | supervised | autonomous).
 *  3. Targets editor (MRR, sites, margin, auto-approve gates).
 *  4. Scoring priors / scout geo knobs.
 *  5. Display time zone.
 */
export function ControlForms({ state, timeZones }: Props & { timeZones: string[] }) {
  return (
    <div className="space-y-8">
      <EnabledSection state={state} />
      <ModeSection state={state} />
      <TimeZoneSection state={state} timeZones={timeZones} />
      <TargetsSection state={state} />
      <ScoringPriorsSection state={state} />
      <ScoutGeoTargetingSection state={state} />
    </div>
  );
}

function TimeZoneSection({ state, timeZones }: Props & { timeZones: string[] }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);
  const [tz, setTz] = useState(state.operatorTimeZone);
  // 'UTC' isn't in Intl.supportedValuesOf('timeZone') on every runtime; make sure
  // it's always selectable so the default is never an orphaned value.
  const options = timeZones.includes('UTC') ? timeZones : ['UTC', ...timeZones];

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateOperatorTimeZone(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Display time zone</p>
        <p className="text-sm text-slate-400 mt-1">
          The zone all dashboard timestamps are shown in. Display only — cron jobs always run in
          UTC on Vercel, so changing this does not reschedule anything.
        </p>
      </header>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-slate-400">
          Time zone
          <select
            name="operatorTimeZone"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="mt-1 block w-full sm:w-72 rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          >
            {options.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || tz === state.operatorTimeZone}
          className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white"
        >
          {pending ? 'Saving…' : 'Save time zone'}
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
            {msg.text}
          </span>
        )}
      </form>
    </section>
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
              Last run <Timestamp value={state.lastOperatorRunAt} />
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

/**
 * Scout geographic-targeting and Stage-3 refinement global knobs (ADR 0022).
 * All fields are nullable — blank resets to the code default (NULL in DB).
 * Blend strengths default to 0.0 (inert); set to 0.3–0.5 to activate.
 * Refine top-K defaults to 0 (Stage 3 disabled).
 */
function ScoutGeoTargetingSection({ state }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<Msg>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    // Emit checkbox as 'on' when checked; absent when unchecked.
    startTransition(async () => {
      const r = await updateScoutGeoKnobs(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Scout geographic targeting (ADR 0022)
        </p>
        <p className="text-sm text-slate-400 mt-1">
          Global defaults for the geo-blend strengths and Stage-3 local-SERP refinement. Leave a
          field blank to use the code default. Per-run overrides in the Scout form take precedence
          over these values.
        </p>
      </header>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs text-slate-400">
          Geo comp blend α (0–1, default 0 = off)
          <input
            type="number"
            min="0"
            max="1"
            step="0.001"
            name="scoutGeoCompBlend"
            defaultValue={state.scoutGeoCompBlend ?? ''}
            placeholder="0 (off)"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
          <span className="block mt-1 text-slate-500">
            Folds metro competition density into winnability. Suggested start: 0.3–0.5.
          </span>
        </label>
        <label className="text-xs text-slate-400">
          Geo demand blend α (0–1, default 0 = off)
          <input
            type="number"
            min="0"
            max="1"
            step="0.001"
            name="scoutGeoDemandBlend"
            defaultValue={state.scoutGeoDemandBlend ?? ''}
            placeholder="0 (off)"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
          <span className="block mt-1 text-slate-500">
            Folds Census demand quality (owner-occ, income, home value) into value estimate.
            Suggested start: 0.3–0.5.
          </span>
        </label>
        <label className="text-xs text-slate-400">
          Per-state cap (int, blank = no cap)
          <input
            type="number"
            min="1"
            step="1"
            name="scoutPerStateCap"
            defaultValue={state.scoutPerStateCap ?? ''}
            placeholder="blank (no cap)"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
          <span className="block mt-1 text-slate-500">
            Max candidates persisted per state. Prevents large states from dominating the top-N list.
          </span>
        </label>
        <label className="text-xs text-slate-400">
          Global refine top-K (int ≥ 0, default 0 = off)
          <input
            type="number"
            min="0"
            step="1"
            name="scoutRefineTopK"
            defaultValue={state.scoutRefineTopK ?? ''}
            placeholder="0 (off)"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
          <span className="block mt-1 text-slate-500">
            Re-scores this many top cells via live DataForSEO local SERP. 0 or blank disables
            Stage-3 refinement globally. Per-run override in the Scout form takes precedence.
          </span>
        </label>
        <label className="text-xs text-slate-400">
          Global refine budget (USD, blank = $3.00 default)
          <input
            type="number"
            min="0"
            step="0.01"
            name="scoutRefineBudgetUsd"
            defaultValue={state.scoutRefineBudgetUsd ?? ''}
            placeholder="3.00"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100"
          />
          <span className="block mt-1 text-slate-500">
            DataForSEO spend cap per refinement pass (~$0.075/cold cell). Cache hits cost $0 and
            never count against the budget.
          </span>
        </label>
        <label className="md:col-span-3 flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none pt-2">
          <input
            type="checkbox"
            name="scoutRefineMeasureVolume"
            defaultChecked={state.scoutRefineMeasureVolume ?? false}
            className="h-4 w-4 rounded border border-slate-600 bg-slate-950 accent-emerald-500"
          />
          Measure local volume during refinement (global default; adds ~$0.001 per cell)
        </label>
        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 inline-flex items-center min-h-[44px] px-4 text-sm font-medium text-white"
          >
            {pending ? 'Saving…' : 'Save geo-targeting knobs'}
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
          Tuning knobs for <code className="text-slate-300">validateNiche</code>. Leave a field
          blank to use the built-in default. Changes apply to the next validation only — they do
          not rescore existing rows.
        </p>
      </header>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs text-slate-400">
          Cluster geo-share (display only — not a score input pending Phase 2)
          <input
            type="number"
            min="0"
            max="1"
            step="0.001"
            name="geoSharePrior"
            defaultValue={state.geoSharePrior ?? ''}
            placeholder="0.15"
            className="mt-1 w-full rounded bg-slate-950 border border-slate-700 min-h-[44px] px-3 text-sm text-slate-100 opacity-60"
          />
          <span className="block mt-1 text-slate-500">
            Editing this field does not affect scores. Reserved for Phase 2 demand model.
          </span>
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
