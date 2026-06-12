'use client';

import { useEffect, useState } from 'react';
import { getLatestAgentRunStatus, type NicheRunStatus, type NicheAgentName } from './actions';

const AGENT_LABELS: Record<NicheAgentName, string> = {
  'niche-scout': 'Scout',
  'niche-validator': 'Validator',
};

/**
 * Polls the niche-engine agents every 2s and renders one bar per agent with
 * non-idle status. Reloads the page when a watched run finishes so fresh
 * rows / scout reports appear.
 */
export function StatusBar({ agents = ['niche-scout', 'niche-validator'] }: { agents?: NicheAgentName[] }) {
  const [statuses, setStatuses] = useState<Partial<Record<NicheAgentName, NicheRunStatus>>>({});
  const [dismissed, setDismissed] = useState<Partial<Record<NicheAgentName, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    const prevStates: Partial<Record<NicheAgentName, string>> = {};

    async function tick() {
      let shouldReload = false;
      await Promise.all(
        agents.map(async (agent) => {
          try {
            const s = await getLatestAgentRunStatus(agent);
            if (cancelled) return;
            setStatuses((prev) => ({ ...prev, [agent]: s }));
            // A fresh run should always be visible, even if the previous
            // result was dismissed.
            if (s.state === 'queued' || s.state === 'running') {
              setDismissed((prev) => (prev[agent] ? { ...prev, [agent]: false } : prev));
            }
            if (prevStates[agent] === 'running' && (s.state === 'succeeded' || s.state === 'failed')) {
              shouldReload = true;
            }
            prevStates[agent] = s.state;
          } catch {
            // Swallow; next tick will retry.
          }
        }),
      );
      if (shouldReload && !cancelled) window.location.reload();
    }

    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(agents)]);

  const visible = agents.filter((agent) => {
    const s = statuses[agent];
    return s && s.state !== 'idle' && !dismissed[agent];
  });
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((agent) => (
        <AgentBar
          key={agent}
          agent={agent}
          status={statuses[agent]!}
          onDismiss={() => setDismissed((prev) => ({ ...prev, [agent]: true }))}
        />
      ))}
    </div>
  );
}

function AgentBar({
  agent,
  status,
  onDismiss,
}: {
  agent: NicheAgentName;
  status: NicheRunStatus;
  onDismiss: () => void;
}) {
  const isTerminal =
    status.state === 'succeeded' || status.state === 'failed' || status.state === 'dead_letter';
  const { color, dot, label } = stateStyles(status.state);
  const pct = status.step && status.total ? Math.round((status.step / status.total) * 100) : null;

  return (
    <div className={`rounded-lg border ${color} p-3 text-sm`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${dot} ${status.state === 'running' || status.state === 'queued' ? 'animate-pulse' : ''}`}
        />
        <span className="font-medium uppercase tracking-wide text-xs">
          {AGENT_LABELS[agent]} · {label}
        </span>
        {status.step && status.total && (
          <span className="text-xs text-slate-400">
            step {status.step}/{status.total}
          </span>
        )}
        <span className="text-slate-200 truncate">{status.message}</span>
        <div className="ml-auto flex items-center gap-2">
          {status.costUsd !== undefined && status.costUsd > 0 && (
            <span className="text-xs text-slate-400">${status.costUsd.toFixed(3)}</span>
          )}
          {isTerminal && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              title="Dismiss"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
      {status.error && <div className="mt-2 text-xs text-red-300 break-words">{status.error}</div>}
    </div>
  );
}

function stateStyles(state: NicheRunStatus['state']) {
  switch (state) {
    case 'queued':
      return { color: 'border-amber-800 bg-amber-950/30', dot: 'bg-amber-400', label: 'Queued' };
    case 'running':
      return { color: 'border-indigo-800 bg-indigo-950/30', dot: 'bg-indigo-400', label: 'Running' };
    case 'succeeded':
      return { color: 'border-emerald-800 bg-emerald-950/30', dot: 'bg-emerald-400', label: 'Done' };
    case 'failed':
      return { color: 'border-red-800 bg-red-950/30', dot: 'bg-red-400', label: 'Failed' };
    case 'dead_letter':
      return { color: 'border-red-900 bg-red-950/40', dot: 'bg-red-500', label: 'Dead-lettered' };
    default:
      return { color: 'border-slate-800 bg-slate-900/40', dot: 'bg-slate-500', label: 'Idle' };
  }
}
