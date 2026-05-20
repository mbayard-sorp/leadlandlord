'use client';

import { useState } from 'react';

interface Props {
  /** Claude brainstorm-time estimate (estSearchVolume, falls back to searchVolume). */
  claudeEstimate: number | null;
  /** DataForSEO 2-seed geo-scoped volume (dfsSearchVolume). */
  dfsSeedVolume: number | null;
  /** DataForSEO Labs cluster aggregate volume (dfsClusterVolume). */
  clusterVolume: number | null;
  /** Geo-share prior used to scale clusterVolume into a single-market estimate. */
  geoSharePrior: number;
  /** Final SEO winnability score string the validation produced. */
  score: string | null;
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

/**
 * Gate A calibration view (ADR 0009). Surfaces the three-way demand comparison
 * the evidence gate depends on — Claude estimate vs DFS 2-seed measured volume
 * vs cluster-blend — and shows which value actually fed computeScore. Rendered
 * only for validated rows (cluster volume present).
 */
export function CalibrationDrawer({
  claudeEstimate,
  dfsSeedVolume,
  clusterVolume,
  geoSharePrior,
  score,
}: Props) {
  const [open, setOpen] = useState(false);

  if (clusterVolume === null) return null;

  const blend = Math.round(clusterVolume * geoSharePrior);
  const demandUsed = Math.max(dfsSeedVolume ?? 0, blend);
  const blendWon = blend >= (dfsSeedVolume ?? 0);
  const estGap =
    claudeEstimate !== null && demandUsed > 0
      ? (claudeEstimate / demandUsed)
      : null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline"
      >
        {open ? 'Hide calibration' : 'View calibration'}
      </button>
      {open && (
        <div className="mt-2 rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300 space-y-2">
          <div className="font-medium text-slate-400">Demand calibration (Gate A)</div>
          <table className="w-full">
            <tbody>
              <tr>
                <td className="py-0.5 text-slate-400">Claude estimate</td>
                <td className="py-0.5 text-right tabular-nums">{fmt(claudeEstimate)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-slate-400">DFS 2-seed (measured)</td>
                <td className="py-0.5 text-right tabular-nums text-emerald-400">{fmt(dfsSeedVolume)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-slate-400">Cluster aggregate</td>
                <td className="py-0.5 text-right tabular-nums">{fmt(clusterVolume)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-slate-400">
                  Cluster blend (×{geoSharePrior})
                </td>
                <td className="py-0.5 text-right tabular-nums text-sky-400">{fmt(blend)}</td>
              </tr>
              <tr className="border-t border-slate-800">
                <td className="pt-1.5 text-slate-300 font-medium">
                  Demand fed to score{' '}
                  <span className="text-slate-500 font-normal">
                    ({blendWon ? 'blend' : 'DFS seed'})
                  </span>
                </td>
                <td className="pt-1.5 text-right tabular-nums font-medium text-slate-100">{fmt(demandUsed)}</td>
              </tr>
            </tbody>
          </table>
          <div className="text-slate-500">
            {estGap !== null ? (
              <>
                Claude was {estGap >= 1 ? `${estGap.toFixed(1)}× high` : `${(1 / estGap).toFixed(1)}× low`} vs
                the demand used.
              </>
            ) : (
              'No demand signal to compare.'
            )}
            {score !== null ? <> Score: <span className="text-slate-300">{score}</span>.</> : null}
          </div>
        </div>
      )}
    </div>
  );
}
