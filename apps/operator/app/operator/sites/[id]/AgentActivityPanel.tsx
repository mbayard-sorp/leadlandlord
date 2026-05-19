'use client';

import { useEffect, useRef, useState } from 'react';
import type { ActivityRun, ActivityResponse } from '../../../api/operator/sites/[id]/activity/route';

const POLL_MS = 4000;

interface Props {
  siteId: string;
}

interface RunNode extends ActivityRun {
  children: RunNode[];
}

export function AgentActivityPanel({ siteId }: Props) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cancelled = useRef(false);

  // Poll the activity endpoint. Stops on unmount; pauses while the tab is
  // hidden so a backgrounded dashboard doesn't keep hammering the API.
  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      try {
        const res = await fetch(`/api/operator/sites/${siteId}/activity`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ActivityResponse;
        if (cancelled.current) return;
        setData(json);
        setError(null);
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [siteId]);

  // Tick a clock for live elapsed-time rendering. Independent of the poll
  // cadence so the timer ticks even when the API is slow.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!data && !error) {
    return <div className="text-sm text-slate-500">Loading activity…</div>;
  }
  if (error && !data) {
    return <div className="text-sm text-red-400">Activity feed: {error}</div>;
  }

  const inflight = data?.inflight ?? [];
  const recent = data?.recent ?? [];
  const tree = buildTree(inflight);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        {tree.length === 0 ? (
          <div className="text-sm text-slate-500">No agents running for this site.</div>
        ) : (
          <ul className="space-y-2">
            {tree.map((node) => (
              <RunRow key={node.id} node={node} now={now} depth={0} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          History (last {recent.length})
        </h3>
        {recent.length === 0 ? (
          <div className="text-sm text-slate-500">No completed runs yet.</div>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:bg-slate-900 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_td]:px-3 [&_td]:py-2 [&_tbody]:divide-y [&_tbody]:divide-slate-800">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>Duration</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/40">
                    <td className="text-slate-400 whitespace-nowrap">{formatTime(r.startedAt)}</td>
                    <td className="font-mono text-xs">{r.agent}</td>
                    <td className="text-slate-400">{formatDuration(durationMs(r))}</td>
                    <td className="text-slate-400">${r.costUsd.toFixed(4)}</td>
                    <td>
                      <StatusPill status={r.status} />
                      {r.error && (
                        <div className="mt-1 text-xs text-red-400 line-clamp-2 max-w-md">
                          {r.error}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && data && (
        <div className="text-xs text-amber-400">⚠ refresh failed: {error} (showing cached)</div>
      )}
    </div>
  );
}

function RunRow({ node, now, depth }: { node: RunNode; now: number; depth: number }) {
  const elapsedMs = now - new Date(node.startedAt).getTime();
  const hasProgress = node.progressStep != null && node.progressTotal != null && node.progressTotal > 0;
  const pct = hasProgress
    ? Math.min(100, Math.round((node.progressStep! / node.progressTotal!) * 100))
    : null;
  const stepLabel = hasProgress ? ` ${node.progressStep}/${node.progressTotal} (${pct}%)` : '';
  return (
    <li>
      <div
        className="flex items-baseline gap-2 text-sm"
        style={{ paddingLeft: depth * 16 }}
      >
        <span className="inline-block w-3 text-emerald-400" aria-hidden>
          ●
        </span>
        <span className="font-mono text-slate-200">{node.agent}</span>
        <span className="text-xs text-slate-500">running {formatDuration(elapsedMs)}</span>
        <span className="ml-auto text-xs text-slate-400">${node.costUsd.toFixed(4)}</span>
      </div>
      {pct !== null && (
        <div
          className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800"
          style={{ marginLeft: depth * 16 + 20, maxWidth: 320 }}
        >
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {node.progressMessage && (
        <div
          className="text-xs text-slate-400 mt-0.5"
          style={{ paddingLeft: depth * 16 + 20 }}
        >
          └─ {node.progressMessage}
          {stepLabel}
        </div>
      )}
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <RunRow key={child.id} node={child} now={now} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function buildTree(rows: ActivityRun[]): RunNode[] {
  const byId = new Map<string, RunNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: RunNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentRunId ? byId.get(node.parentRunId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Stable order: oldest first within each level (parents typically started
  // before children, child order matches DB-assigned parentRunId chain).
  const sortByStart = (a: RunNode, b: RunNode) =>
    a.startedAt.localeCompare(b.startedAt);
  roots.sort(sortByStart);
  for (const node of byId.values()) node.children.sort(sortByStart);
  return roots;
}

function durationMs(r: ActivityRun): number {
  const start = new Date(r.startedAt).getTime();
  const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m}m ${remS.toString().padStart(2, '0')}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function StatusPill({ status }: { status: ActivityRun['status'] }) {
  const tone =
    status === 'succeeded'
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : status === 'failed'
      ? 'text-red-300 border-red-700/50 bg-red-900/30'
      : status === 'budget_exceeded'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : status === 'running'
      ? 'text-sky-300 border-sky-700/50 bg-sky-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
