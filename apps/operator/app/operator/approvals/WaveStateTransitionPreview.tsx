interface WaveStateTransitionPayload {
  waveId: string;
  fromState: string;
  toState: string;
  evidence?: Record<string, unknown>;
  blockers?: string[];
}

function isPayload(p: unknown): p is WaveStateTransitionPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return typeof o.waveId === 'string' && typeof o.fromState === 'string' && typeof o.toState === 'string';
}

function evidenceSummary(evidence: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof evidence.builtSiteCount === 'number') parts.push(`built: ${evidence.builtSiteCount}`);
  if (typeof evidence.indexedSiteCount === 'number') parts.push(`indexed: ${evidence.indexedSiteCount}`);
  if (evidence.agingUntil) parts.push(`agingUntil: ${String(evidence.agingUntil).slice(0, 10)}`);
  if (typeof evidence.monitoringWeeksElapsed === 'number') parts.push(`monitoringWeeks: ${evidence.monitoringWeeksElapsed}`);
  if (evidence.manual) parts.push('manual override');
  return parts.join(' · ');
}

interface Props {
  payload: unknown;
}

export function WaveStateTransitionPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return (
      <span className="text-red-400 text-xs">Invalid wave_state_transition payload</span>
    );
  }

  const summary = payload.evidence ? evidenceSummary(payload.evidence) : null;
  const hasBlockers = Array.isArray(payload.blockers) && payload.blockers.length > 0;

  return (
    <div className="space-y-1.5 text-sm">
      <div className="text-slate-300">
        Wave{' '}
        <span className="font-mono text-xs bg-slate-800 px-1 rounded text-slate-200">
          {payload.waveId.slice(0, 8)}…
        </span>
        {': '}
        <span className="font-medium">{payload.fromState}</span>
        {' → '}
        <span className="font-medium text-indigo-300">{payload.toState}</span>
      </div>

      {summary && (
        <div className="text-xs text-slate-500">{summary}</div>
      )}

      {hasBlockers && (
        <div className="text-xs text-rose-400">
          Blockers: {(payload.blockers as string[]).join('; ')}
        </div>
      )}
    </div>
  );
}
