import type { OutcomeWeekRow } from './niche-outcomes';

interface Props {
  /** Claude brainstorm-time estimate (estSearchVolume, falls back to searchVolume). */
  claudeEstimate: number | null;
  /** DataForSEO 2-seed geo-scoped volume (dfsSearchVolume). */
  dfsSeedVolume: number | null;
  /** DataForSEO Labs cluster aggregate volume (dfsClusterVolume). */
  clusterVolume: number | null;
  /**
   * The volume actually fed to computeScore — computed server-side via
   * resolveDemandVolume(dfsSearchVolume, estSearchVolume) and threaded down
   * through NicheRow. Not recomputed here to keep agents out of the client bundle.
   */
  demandUsed: number;
  /** Which source resolveDemandVolume chose. */
  demandSource: 'dataforseo' | 'claude_estimate';
  /** Final SEO winnability score string the validation produced. */
  score: string | null;
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

function Stat({
  label,
  value,
  valueClass = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-slate-500">{label}</span>
      <span className={`tabular-nums text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

/**
 * Gate A calibration view (ADR 0009). Surfaces the four demand signals:
 * Claude estimate, DFS 2-seed measured, cluster aggregate (national), and
 * cluster x geo-share (display-only cross-check). Shows which value actually
 * fed computeScore via resolveDemandVolume. Laid out horizontally so it reads
 * as a full-width detail strip beneath the row. Renders only for validated rows
 * (cluster volume present); expand state owned by the row component.
 */
export function CalibrationContent({
  claudeEstimate,
  dfsSeedVolume,
  clusterVolume,
  demandUsed,
  demandSource,
  score,
}: Props) {
  if (clusterVolume === null) return null;

  const demandNote =
    demandSource === 'dataforseo'
      ? `DFS measured (${fmt(dfsSeedVolume)}) >= trust floor (100/mo) — used measured volume.`
      : `DFS measured (${fmt(dfsSeedVolume)}) below trust floor (100/mo) — used Claude estimate (${fmt(claudeEstimate)}).`;

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
      <div className="font-medium text-slate-400 mb-2">Demand calibration (Gate A)</div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Stat label="Claude estimate" value={fmt(claudeEstimate)} />
        <Stat
          label="DFS 2-seed (measured)"
          value={fmt(dfsSeedVolume)}
          valueClass="text-emerald-400"
        />
        <Stat label="Cluster aggregate (national)" value={fmt(clusterVolume)} />
        <div className="hidden sm:block h-9 w-px bg-slate-800" aria-hidden />
        <Stat
          label={`Demand fed to score (${demandSource === 'dataforseo' ? 'DFS measured' : 'Claude estimate'})`}
          value={fmt(demandUsed)}
          valueClass="text-slate-100 font-semibold"
        />
        <div className="self-center text-slate-500">
          {demandNote}
          {score !== null ? (
            <>
              {' '}
              Score: <span className="text-slate-300">{score}</span>.
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface OutcomesProps {
  weeks: OutcomeWeekRow[];
  /** Scout/validate predicted monthly value (niches.est_monthly_value_usd), for the note line. */
  estMonthlyValueUsd: string | null;
}

/**
 * Predicted-vs-actual outcomes section (Phase 2 calibration feedback loop).
 * Up to 8 weeks of niche_outcome_snapshots for the niche's linked site,
 * newest first. Purely presentational — `weeks` is fetched server-side
 * (page.tsx via loadOutcomeWeeksForSite) and passed down as a prop so this
 * stays renderable from the client-component NicheRow without a client-side
 * DB fetch.
 */
export function OutcomesContent({ weeks, estMonthlyValueUsd }: OutcomesProps) {
  if (weeks.length === 0) return null;

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
      <div className="font-medium text-slate-400 mb-2">
        Outcomes — predicted vs. actual (last {weeks.length} week{weeks.length === 1 ? '' : 's'})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="pr-3 py-1 font-normal">Week</th>
              <th className="pr-3 py-1 font-normal">Money-kw rank</th>
              <th className="pr-3 py-1 font-normal">Overall rank</th>
              <th className="pr-3 py-1 font-normal">Observed CTR</th>
              <th className="pr-3 py-1 font-normal">Observed call rate</th>
              <th className="pr-3 py-1 font-normal">Impressions / clicks</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekStart} className="border-b border-slate-900 last:border-0">
                <td className="pr-3 py-1 tabular-nums">{w.weekStart}</td>
                <td className="pr-3 py-1 tabular-nums">
                  {w.moneyKwPosition !== null ? `#${w.moneyKwPosition.toFixed(1)}` : '—'}
                </td>
                <td className="pr-3 py-1 tabular-nums text-slate-500">
                  {w.overallPosition !== null ? `#${w.overallPosition.toFixed(1)}` : '—'}
                </td>
                <td className="pr-3 py-1 tabular-nums text-sky-300">
                  {w.observedCtr !== null ? `${(w.observedCtr * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="pr-3 py-1 tabular-nums text-sky-300">
                  {w.observedCallRate !== null ? `${(w.observedCallRate * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="pr-3 py-1 tabular-nums text-slate-500">
                  {w.impressions.toLocaleString()} / {w.clicks.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {estMonthlyValueUsd !== null && (
        <p className="mt-2 text-slate-500">
          Predicted monthly value: <span className="text-slate-300">${Number(estMonthlyValueUsd).toFixed(0)}/mo</span>.
          Compare against observed CTR/call-rate above — the scout-time priors that fed this prediction are
          scout_ctr_at_rank/scout_call_rate (see the Suggestions panel above for data-derived adjustments).
        </p>
      )}
    </div>
  );
}
