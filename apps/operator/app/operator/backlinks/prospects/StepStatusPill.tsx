'use client';

export type PillStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'budget_exceeded';

interface Props {
  status: PillStatus;
  progressMessage?: string | null;
  progressStep?: number | null;
  progressTotal?: number | null;
  lastRunAt?: string | null;
  error?: string | null;
  onRetry?: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function StepStatusPill({
  status,
  progressMessage,
  progressStep,
  progressTotal,
  lastRunAt,
  error,
  onRetry,
}: Props) {
  if (status === 'idle') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-800/60 border border-slate-700 text-slate-400">
        Ready
      </span>
    );
  }

  if (status === 'running') {
    const pct =
      progressStep != null && progressTotal != null && progressTotal > 0
        ? Math.round((progressStep / progressTotal) * 100)
        : null;
    return (
      <span className="inline-flex flex-col gap-1 min-w-0">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-amber-900/40 border border-amber-700/60 text-amber-300 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          {progressMessage ?? 'Running…'}
        </span>
        {pct != null && (
          <span className="h-1 w-full bg-slate-800 rounded overflow-hidden">
            <span
              className="block h-full bg-amber-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </span>
    );
  }

  if (status === 'succeeded') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-900/30 border border-emerald-700/50 text-emerald-300">
        Done{lastRunAt ? ` — ${relativeTime(lastRunAt)}` : ''}
      </span>
    );
  }

  if (status === 'budget_exceeded') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-900/30 border border-amber-700/50 text-amber-300">
        Cap reached
      </span>
    );
  }

  // failed
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-900/30 border border-red-700/50 text-red-300">
        Failed{error ? `: ${error.slice(0, 60)}` : ''}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs px-2 py-0.5 rounded bg-red-700/30 hover:bg-red-700/50 text-red-200 border border-red-700/40"
        >
          Retry
        </button>
      )}
    </span>
  );
}
