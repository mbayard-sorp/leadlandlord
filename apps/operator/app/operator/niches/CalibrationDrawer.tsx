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
