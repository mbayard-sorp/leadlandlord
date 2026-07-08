'use client';

import { useState, useTransition } from 'react';
import { runNicheValidation, runNicheValidationForCandidates } from './actions';
import { CATEGORY_LABELS } from './NicheRow';
import { Timestamp } from '../../../components/Timestamp';

export interface ScoutCandidateData {
  id: string;
  rank: number;
  trade: string;
  category: string;
  city: string;
  state: string;
  population: number;
  estMonthlyValueUsd: string;
  winnability: string | null;
  clusterDifficulty: string | null;
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
      excluded_floor?: number;
      excluded_winnability?: number;
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
      /** ADR 0022 geo-tier surface — may be absent on older reports. */
      geo_tiers?: {
        states: Array<{
          state: string;
          demandDensity: number;
          competitionSaturation: number;
          geoAttractiveness: number;
          candidateCount: number;
        }>;
        metros: Array<{
          county: string;
          state: string;
          demandDensity: number;
          competitionSaturation: number;
          geoAttractiveness: number;
          candidateCount: number;
        }>;
        census_hit_rate: number;
      };
    };
    /** ADR 0022 Stage-3 refinement summary — may be absent on older reports. */
    refinement?: {
      refined_count: number;
      refine_spend_usd: number;
      refine_budget_exhausted: boolean;
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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const eligible = candidates.filter((c) => c.status === 'scouted');
  const selectedTrades = new Set(
    candidates.filter((c) => selectedIds.has(c.id)).map((c) => c.trade.toLowerCase()),
  );

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Pick the best-ranked (lowest rank) eligible candidate of each distinct
   * trade — one of each, no duplicate trades — capped at the validator's
   * 50-candidate ceiling (keeping the best-ranked trades). Expands the table so
   * every auto-selected row is visible.
   */
  function selectBestPerTrade() {
    const byTrade = new Map<string, string>();
    for (const c of [...eligible].sort((a, b) => a.rank - b.rank)) {
      const key = c.trade.toLowerCase();
      if (!byTrade.has(key)) byTrade.set(key, c.id);
    }
    setSelectedIds(new Set([...byTrade.values()].slice(0, 50)));
    setExpanded(true);
    setMsg(null);
  }

  function validateSelected() {
    setMsg(null);
    startTransition(async () => {
      const r = await runNicheValidationForCandidates(run.id, [...selectedIds]);
      setMsg({ ok: r.ok, text: r.message ?? '' });
      if (r.ok) setSelectedIds(new Set());
    });
  }

  const shown = expanded ? candidates : candidates.slice(0, 25);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold text-slate-200">
            Scout: {run.states.join(', ')}
            {run.categoryFilter
              ? ` · ${run.categoryFilter
                  .split(',')
                  .map((c) => CATEGORY_LABELS[c] ?? c)
                  .join(', ')}`
              : ''}
          </h2>
          <span className="text-xs text-slate-500">
            <Timestamp value={run.createdAt} /> · {run.report.grid.trades} trades ×{' '}
            {run.report.grid.cities} cities = {run.gridCells.toLocaleString()} cells ·{' '}
            {run.report.grid.excluded_existing} already in pipeline ·{' '}
            {(run.report.grid.excluded_floor ?? 0) > 0 && (
              <span className="text-amber-400">{run.report.grid.excluded_floor} below floor · </span>
            )}
            {(run.report.grid.excluded_winnability ?? 0) > 0 && (
              <span className="text-amber-400">{run.report.grid.excluded_winnability} unrankable · </span>
            )}
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

        {/* Best geographies — ADR 0022 geo-tier surface */}
        {run.report.insights.geo_tiers && (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
                Best geographies
              </p>
              <span className="text-[10px] text-slate-600">
                Census hit rate: {(run.report.insights.geo_tiers.census_hit_rate * 100).toFixed(1)}%
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Top states */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">
                  Top states by attractiveness
                </p>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600 border-b border-slate-800">
                      <th className="pb-1 pr-2">State</th>
                      <th className="pb-1 pr-2">Attract.</th>
                      <th className="pb-1 pr-2">Demand</th>
                      <th className="pb-1 pr-2">Saturation</th>
                      <th className="pb-1">Cells</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.report.insights.geo_tiers.states.slice(0, 10).map((s) => (
                      <tr key={s.state} className="border-b border-slate-800/40 last:border-0">
                        <td className="py-0.5 pr-2 font-medium text-slate-200">{s.state}</td>
                        <td className="py-0.5 pr-2 text-emerald-300">{s.geoAttractiveness.toFixed(3)}</td>
                        <td className="py-0.5 pr-2 text-slate-300">{s.demandDensity.toFixed(3)}</td>
                        <td className="py-0.5 pr-2 text-amber-300">{(s.competitionSaturation * 100).toFixed(1)}%</td>
                        <td className="py-0.5 text-slate-500">{s.candidateCount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Top metros (counties) */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">
                  Top metros by attractiveness
                </p>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600 border-b border-slate-800">
                      <th className="pb-1 pr-2">County</th>
                      <th className="pb-1 pr-2">Attract.</th>
                      <th className="pb-1 pr-2">Demand</th>
                      <th className="pb-1 pr-2">Saturation</th>
                      <th className="pb-1">Cells</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.report.insights.geo_tiers.metros.slice(0, 10).map((m) => (
                      <tr key={`${m.county}|${m.state}`} className="border-b border-slate-800/40 last:border-0">
                        <td className="py-0.5 pr-2 font-medium text-slate-200">
                          {m.county}, {m.state}
                        </td>
                        <td className="py-0.5 pr-2 text-emerald-300">{m.geoAttractiveness.toFixed(3)}</td>
                        <td className="py-0.5 pr-2 text-slate-300">{m.demandDensity.toFixed(3)}</td>
                        <td className="py-0.5 pr-2 text-amber-300">{(m.competitionSaturation * 100).toFixed(1)}%</td>
                        <td className="py-0.5 text-slate-500">{m.candidateCount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Refinement summary — ADR 0022 Stage-3 */}
        {run.report.refinement && run.report.refinement.refined_count > 0 && (
          <div className="rounded border border-slate-700 bg-slate-800/40 px-3 py-2 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">
              Refinement (Stage 3 — local SERP)
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-300">
              <span>
                <span className="text-slate-400">Cells refined: </span>
                <span className="font-medium text-emerald-300">
                  {run.report.refinement.refined_count.toLocaleString()}
                </span>
              </span>
              <span>
                <span className="text-slate-400">DFS spend: </span>
                <span className="font-medium text-slate-200">
                  ${run.report.refinement.refine_spend_usd.toFixed(4)}
                </span>
              </span>
              {run.report.refinement.refine_budget_exhausted && (
                <span className="inline-flex items-center rounded border border-amber-800 bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                  budget exhausted
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Manual selection toolbar — hand-pick candidates for validation */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2">
        <button
          type="button"
          onClick={selectBestPerTrade}
          disabled={pending || eligible.length === 0}
          className="inline-flex items-center min-h-[34px] rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 text-xs font-medium text-slate-200"
        >
          Select best per trade
        </button>
        {selectedIds.size > 0 && (
          <button type="button" onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-200">
            Clear
          </button>
        )}
        <span className="text-xs text-slate-400">
          {selectedIds.size} selected · {selectedTrades.size} trade{selectedTrades.size === 1 ? '' : 's'}
          {selectedIds.size > 50 && <span className="text-amber-400"> · max 50, deselect {selectedIds.size - 50}</span>}
        </span>
        <button
          type="button"
          onClick={validateSelected}
          disabled={pending || selectedIds.size === 0 || selectedIds.size > 50}
          className="ml-auto inline-flex items-center justify-center min-h-[34px] rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-xs font-medium text-white"
        >
          {pending ? 'Queuing…' : `Validate selected (${selectedIds.size})`}
        </button>
      </div>

      {/* Candidate table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <Th className="w-8" />
              <Th>#</Th>
              <Th>Trade</Th>
              <Th className="hidden md:table-cell">Category</Th>
              <Th>City</Th>
              <Th className="hidden md:table-cell">Pop</Th>
              <Th>Est $/mo</Th>
              <Th className="hidden lg:table-cell">Win%</Th>
              <Th className="hidden lg:table-cell">KD</Th>
              <Th className="hidden lg:table-cell">Flags</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr
                key={c.id}
                className={`border-b border-slate-800/60 last:border-0 ${selectedIds.has(c.id) ? 'bg-emerald-950/30' : ''}`}
              >
                <Td className="w-8">
                  {c.status === 'scouted' ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      aria-label={`Select ${c.trade} in ${c.city}, ${c.state}`}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  ) : null}
                </Td>
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
                <Td className="hidden lg:table-cell text-xs text-slate-300">
                  {c.winnability !== null
                    ? `${(Number(c.winnability) * 100).toFixed(0)}%`
                    : <span className="text-slate-600">—</span>}
                </Td>
                <Td className="hidden lg:table-cell text-xs text-slate-400">
                  {c.clusterDifficulty !== null
                    ? Number(c.clusterDifficulty).toFixed(0)
                    : <span className="text-slate-600">—</span>}
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
