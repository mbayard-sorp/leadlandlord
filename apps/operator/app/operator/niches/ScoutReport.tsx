'use client';

import { useState, useTransition } from 'react';
import { runNicheValidation } from './actions';
import { CATEGORY_LABELS } from './NicheRow';

export interface ScoutCandidateData {
  id: string;
  rank: number;
  trade: string;
  category: string;
  city: string;
  state: string;
  population: number;
  estMonthlyValueUsd: string;
  isNovelTrade: boolean;
  dataConfidence: string;
  status: string;
  validatedValueUsd: string | null;
}

export interface ScoutRunData {
  id: string;
  createdAt: string;
  states: string[];
  categoryFilter: string | null;
  gridCells: number;
  persistedCandidates: number;
  report: {
    grid: {
      trades: number;
      cities: number;
      cells: number;
      excluded_existing: number;
      excluded_denylist: number;
      uncached_trades: number;
    };
    value_curve: Array<{ n: number; min_value_usd: number; cumulative_validation_cost_usd: number }>;
    recommendation: {
      n: number;
      value_floor_usd: number;
      est_validation_cost_usd: number;
      rationale: string;
    };
    insights: {
      population_bands: Array<{ band: string; share_of_top100_value: number }>;
      category_concentration: Array<{ category: string; count_in_top100: number }>;
      novel_trades_in_top100: number;
    };
  };
}

export function ScoutReport({
  run,
  candidates,
}: {
  run: ScoutRunData;
  candidates: ScoutCandidateData[];
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rec = run.report.recommendation;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    fd.set('scout_run_id', run.id);
    startTransition(async () => {
      const r = await runNicheValidation(fd);
      setMsg({ ok: r.ok, text: r.message ?? '' });
    });
  }

  const shown = expanded ? candidates : candidates.slice(0, 25);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-200">
            Scout: {run.states.join(', ')}
            {run.categoryFilter ? ` · ${CATEGORY_LABELS[run.categoryFilter] ?? run.categoryFilter}` : ''}
          </h2>
          <span className="text-xs text-slate-500">
            {new Date(run.createdAt).toLocaleString()} · {run.report.grid.trades} trades ×{' '}
            {run.report.grid.cities} cities = {run.gridCells.toLocaleString()} cells ·{' '}
            {run.report.grid.excluded_existing} already in pipeline ·{' '}
            {run.report.grid.uncached_trades} trades benchmark-only
          </span>
        </div>

        {/* Recommendation banner + validate form */}
        <form
          onSubmit={onSubmit}
          className="rounded border border-emerald-900 bg-emerald-950/30 p-3 flex flex-wrap items-center gap-3"
        >
          <p className="text-sm text-emerald-200 flex-1 min-w-[240px]">
            {rec.rationale} Est. cost ${rec.est_validation_cost_usd.toFixed(2)}.
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            Validate top
            <input
              name="count"
              type="number"
              min={1}
              max={50}
              defaultValue={Math.max(1, Math.min(50, rec.n))}
              inputMode="numeric"
              className="w-16 rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center min-h-[38px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-sm font-medium text-white"
          >
            {pending ? 'Queuing…' : 'Validate'}
          </button>
          {msg && (
            <p className={`w-full text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
          )}
        </form>

        {/* Value curve summary */}
        {run.report.value_curve.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
            {run.report.value_curve.map((p) => (
              <span key={p.n} className="rounded bg-slate-800/60 px-2 py-1">
                top {p.n} ≥ ${p.min_value_usd.toFixed(0)}/mo · ${p.cumulative_validation_cost_usd.toFixed(2)}
              </span>
            ))}
          </div>
        )}

        {/* Insights */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>
            Top-100 value by city size:{' '}
            {run.report.insights.population_bands
              .filter((b) => b.share_of_top100_value > 0)
              .map((b) => `${b.band} ${(b.share_of_top100_value * 100).toFixed(0)}%`)
              .join(' · ')}
          </span>
          <span>
            Categories:{' '}
            {run.report.insights.category_concentration
              .slice(0, 4)
              .map((c) => `${CATEGORY_LABELS[c.category] ?? c.category} ${c.count_in_top100}`)
              .join(' · ')}
          </span>
          <span>{run.report.insights.novel_trades_in_top100} novel trades in top 100</span>
        </div>
      </div>

      {/* Candidate table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <Th>#</Th>
              <Th>Trade</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th>City</Th>
              <Th className="hidden md:table-cell">Pop</Th>
              <Th>Est $/mo</Th>
              <Th className="hidden lg:table-cell">Flags</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="border-b border-slate-800/60 last:border-0">
                <Td className="text-slate-500">{c.rank}</Td>
                <Td className="break-words">{c.trade}</Td>
                <Td className="hidden md:table-cell text-xs text-slate-400">
                  {CATEGORY_LABELS[c.category] ?? c.category}
                </Td>
                <Td>
                  {c.city}, {c.state}
                  <span className="md:hidden text-xs text-slate-500"> · {c.population.toLocaleString()}</span>
                </Td>
                <Td className="hidden md:table-cell text-xs text-slate-400">
                  {c.population.toLocaleString()}
                </Td>
                <Td className="font-medium text-emerald-300">
                  ${Number(c.estMonthlyValueUsd).toFixed(0)}
                  {c.validatedValueUsd !== null && (
                    <span className="ml-1 text-xs text-violet-300">
                      → ${Number(c.validatedValueUsd).toFixed(0)} val
                    </span>
                  )}
                </Td>
                <Td className="hidden lg:table-cell">
                  <span className="flex gap-1">
                    {c.isNovelTrade && <Badge tone="amber">novel</Badge>}
                    {c.dataConfidence === 'benchmark_only' && <Badge tone="slate">benchmark</Badge>}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {candidates.length > 25 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-slate-800 py-2 text-xs text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
        >
          {expanded ? 'Show top 25' : `Show all ${candidates.length}`}
        </button>
      )}
    </section>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'slate' }) {
  const classes =
    tone === 'amber'
      ? 'bg-amber-950/60 border-amber-800 text-amber-300'
      : 'bg-slate-800 border-slate-700 text-slate-400';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${classes}`}>
      {children}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    scouted: { label: 'scouted', classes: 'text-slate-500' },
    queued: { label: 'queued', classes: 'text-amber-400' },
    validated: { label: 'validated', classes: 'text-emerald-400' },
    validation_failed: { label: 'failed', classes: 'text-red-400' },
  };
  const entry = map[status] ?? { label: status, classes: 'text-slate-500' };
  return <span className={`text-xs font-medium ${entry.classes}`}>{entry.label}</span>;
}
