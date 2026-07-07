import { desc, eq } from 'drizzle-orm';
import { getDb, calibrationSuggestions, type CalibrationSuggestion } from '@leadlandlord/db';
import { ApplySuggestionButton, DismissSuggestionButton } from './SuggestionActions';

const KNOB_LABELS: Record<string, string> = {
  scout_ctr_at_rank: 'CTR at rank',
  scout_call_rate: 'Call rate',
};

function scopeLabel(row: CalibrationSuggestion): string {
  if (row.scope === 'global') return 'Global';
  if (row.scope === 'trade') return `Trade: ${row.trade ?? '—'}`;
  return `Trade+State: ${row.trade ?? '—'} / ${row.state ?? '—'}`;
}

function fmtValue(v: string): string {
  return `${(Number(v) * 100).toFixed(2)}%`;
}

/**
 * Server component (fetches its own data — no client-side Sanity/DB reads).
 * Lists every open calibration_suggestions row, newest first.
 *
 * CRITICAL: only scope='global' rows render an Apply button. scope='trade'
 * and scope='trade_state' rows are informational — they guide manual
 * hand-tuning of TRADE_BENCHMARKS entries in lead-benchmarks.ts, but a
 * single global system_state knob cannot represent a per-trade value, so
 * applying them directly would silently overwrite the global prior with a
 * number that only makes sense for one trade. The server action
 * (applyCalibrationSuggestion) re-validates scope==='global' itself —
 * hiding the button here is a UX nicety, not the enforcement boundary.
 */
export async function SuggestionsPanel() {
  const db = getDb();
  const rows = await db
    .select()
    .from(calibrationSuggestions)
    .where(eq(calibrationSuggestions.status, 'open'))
    .orderBy(desc(calibrationSuggestions.createdAt))
    .limit(100);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300 mb-1">
        Calibration suggestions ({rows.length})
      </h2>
      <p className="text-xs text-slate-500 mb-3">
        Data-derived from niche_outcome_snapshots (niche-prior-suggester, weekly). Only <strong>Global</strong>{' '}
        suggestions can be applied directly — they map 1:1 to a system_state knob. Trade and Trade+State
        suggestions are informational: use them to hand-tune the matching TRADE_BENCHMARKS entry in
        lead-benchmarks.ts, since a single global knob can&apos;t represent a per-trade value.
      </p>
      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800 uppercase tracking-wide">
              <th className="px-2 py-1.5 font-medium">Scope</th>
              <th className="px-2 py-1.5 font-medium">Knob</th>
              <th className="px-2 py-1.5 font-medium">Suggested</th>
              <th className="px-2 py-1.5 font-medium">Current prior</th>
              <th className="px-2 py-1.5 font-medium">Observed</th>
              <th className="px-2 py-1.5 font-medium">Sample</th>
              <th className="px-2 py-1.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const evidence = (row.evidence ?? {}) as { observed?: number; currentPrior?: number };
              return (
                <tr key={row.id} className="border-b border-slate-900 last:border-0">
                  <td className="px-2 py-1.5 whitespace-nowrap">{scopeLabel(row)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{KNOB_LABELS[row.knob] ?? row.knob}</td>
                  <td className="px-2 py-1.5 font-medium text-emerald-400">{fmtValue(row.suggestedValue)}</td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {evidence.currentPrior != null ? `${(evidence.currentPrior * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">
                    {evidence.observed != null ? `${(evidence.observed * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-slate-500">{row.sampleSize}</td>
                  <td className="px-2 py-1.5">
                    {row.scope === 'global' ? (
                      <ApplySuggestionButton id={row.id} />
                    ) : (
                      <DismissSuggestionButton id={row.id} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
