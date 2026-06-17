'use client';

import { usePolledFetch } from '@/lib/use-polled-fetch';
import type { ProgressResponse, ProgressStage } from '../../../api/operator/sites/[id]/progress/route';
import { useOperatorTimeZone } from '../../../../components/Timestamp';
import { formatInTimeZone } from '../../../../lib/format-date';

interface Props {
  siteId: string;
}

/**
 * Horizontal build-progress stepper. Polls the /progress endpoint at 4s.
 * Hidden once site.status === 'live' AND deployedAt > 24h ago (server derives
 * this in the route and returns hideBar=true — client just respects the flag
 * so there's no date math here).
 */
export function BuildProgressBar({ siteId }: Props) {
  const { data, error, loading } = usePolledFetch<ProgressResponse>(
    `/api/operator/sites/${siteId}/progress`,
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-500 animate-pulse">
        Loading build progress…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-amber-400">
        Build progress unavailable: {error}
      </div>
    );
  }

  if (!data) return null;

  // Server signals the bar should be hidden (live + >24h ago)
  if (data.hideBar) return null;

  const { stages } = data;

  // Determine the index of the last "done" stage to know which nodes to fill
  const lastDoneIdx = stages.reduce((acc, s, i) => (s.status === 'done' ? i : acc), -1);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-4">
        Build progress
      </h2>

      {/* Stepper — responsive: single column on mobile, horizontal on md+ */}
      <ol className="flex flex-col md:flex-row md:items-start gap-2 md:gap-0">
        {stages.map((stage, i) => (
          <StepNode
            key={stage.id}
            stage={stage}
            index={i}
            total={stages.length}
            isConnectorFilled={i < lastDoneIdx}
          />
        ))}
      </ol>

      {error && data && (
        <p className="mt-2 text-xs text-amber-400">Refresh failed: {error} (showing cached)</p>
      )}
    </div>
  );
}

function StepNode({
  stage,
  index,
  total,
  isConnectorFilled,
}: {
  stage: ProgressStage;
  index: number;
  total: number;
  isConnectorFilled: boolean;
}) {
  const tz = useOperatorTimeZone();
  const isLast = index === total - 1;

  const dotClass =
    stage.status === 'done'
      ? 'bg-emerald-500 border-emerald-500'
      : stage.status === 'running'
      ? 'bg-sky-400 border-sky-400 animate-pulse'
      : stage.status === 'failed'
      ? 'bg-red-500 border-red-500'
      : 'bg-transparent border-slate-600';

  const labelClass =
    stage.status === 'done'
      ? 'text-emerald-300'
      : stage.status === 'running'
      ? 'text-sky-300 font-semibold'
      : stage.status === 'failed'
      ? 'text-red-300'
      : 'text-slate-500';

  return (
    <li className="flex md:flex-col md:items-center md:flex-1 gap-2 md:gap-0">
      {/* Dot + connector row (horizontal on md+) */}
      <div className="flex md:flex-row items-center md:w-full">
        {/* Dot */}
        <span
          className={`shrink-0 w-3 h-3 rounded-full border-2 ${dotClass}`}
          title={stageTitle(stage, tz)}
          aria-label={`${stage.label}: ${stage.status}`}
        />
        {/* Connector line */}
        {!isLast && (
          <span
            className={`flex-1 h-0.5 mx-1 ${isConnectorFilled ? 'bg-emerald-600' : 'bg-slate-700'}`}
          />
        )}
      </div>

      {/* Label + meta below the dot on md+ */}
      <div className="md:mt-2 md:text-center md:px-1">
        <p className={`text-xs leading-tight ${labelClass}`}>{stage.label}</p>
        {stage.status === 'done' && stage.durationMs != null && (
          <p className="text-xs text-slate-600 mt-0.5">{formatDuration(stage.durationMs)}</p>
        )}
        {stage.status === 'done' && stage.costUsd != null && stage.costUsd > 0 && (
          <p className="text-xs text-slate-600">${stage.costUsd.toFixed(4)}</p>
        )}
        {stage.status === 'failed' && stage.error && (
          <p className="text-xs text-red-400 mt-0.5 max-w-[8rem] truncate" title={stage.error}>
            {stage.error}
          </p>
        )}
      </div>
    </li>
  );
}

function stageTitle(stage: ProgressStage, tz: string): string {
  const parts = [stage.label, `Status: ${stage.status}`];
  if (stage.startedAt) parts.push(`Started: ${formatInTimeZone(stage.startedAt, tz)}`);
  if (stage.durationMs != null) parts.push(`Duration: ${formatDuration(stage.durationMs)}`);
  if (stage.costUsd != null) parts.push(`Cost: $${stage.costUsd.toFixed(4)}`);
  if (stage.error) parts.push(`Error: ${stage.error}`);
  return parts.join(' | ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m}m ${remS.toString().padStart(2, '0')}s`;
}
