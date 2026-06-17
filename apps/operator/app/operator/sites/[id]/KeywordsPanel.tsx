'use client';

import { useState, useTransition } from 'react';
import type { SanityKeywordClusterSummary } from '@/lib/sanity-read';
import { repullKeywords, retargetContent, generateLongform } from './actions';
import { Timestamp } from '../../../../components/Timestamp';

interface Props {
  siteId: string;
  clusters: SanityKeywordClusterSummary[];
}

const STATUS_STYLES: Record<string, string> = {
  planned: 'bg-slate-700 text-slate-200',
  covered: 'bg-emerald-800/60 text-emerald-100',
  gap: 'bg-red-800/60 text-red-100',
  underperforming: 'bg-amber-800/60 text-amber-100',
  retired: 'bg-slate-800 text-slate-500',
};

const KIND_LABELS: Record<string, string> = {
  home: 'Home',
  service: 'Service',
  service_area: 'Service Area',
  blog: 'Blog',
  info: 'Info',
};

export function KeywordsPanel({ siteId, clusters }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function onRepull() {
    setMsg(null);
    startTransition(async () => {
      const r = await repullKeywords(siteId);
      setMsg({
        ok: r.ok,
        text: r.ok
          ? `Re-pull queued (event ${r.eventId?.slice(0, 8)}…). Operator-tick will run keyword-planner within ~1 minute.`
          : r.message ?? 'Re-pull failed',
      });
    });
  }
  function onRetarget() {
    setMsg(null);
    startTransition(async () => {
      const r = await retargetContent(siteId);
      setMsg({
        ok: r.ok,
        text: r.ok
          ? `Re-target queued (event ${r.eventId?.slice(0, 8)}…). Site Builder will regenerate content against existing clusters.`
          : r.message ?? 'Re-target failed',
      });
    });
  }
  function onGenerateLongform() {
    setMsg(null);
    startTransition(async () => {
      const r = await generateLongform(siteId);
      setMsg({
        ok: r.ok,
        text: r.ok
          ? `Long-form generation queued (event ${r.eventId?.slice(0, 8)}…). Site Builder will regenerate just the keyword-rich home intro within ~1 minute.`
          : r.message ?? 'Long-form generation failed',
      });
    });
  }

  const totalVolume = clusters.reduce((s, c) => s + (c.totalVolume ?? 0), 0);
  const covered = clusters.filter((c) => c.status === 'covered').length;
  const planned = clusters.filter((c) => c.status === 'planned').length;
  const gaps = clusters.filter((c) => c.status === 'gap').length;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Keywords</p>
          <p className="text-sm text-slate-300 mt-1">
            Pre-planned keyword clusters from DataForSEO. Each cluster maps to one page.
          </p>
          {clusters.length > 0 ? (
            <p className="text-xs text-slate-500 mt-1">
              {clusters.length} clusters · {covered} covered · {planned} planned · {gaps} gaps · total monthly volume {totalVolume.toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRepull}
            disabled={pending}
            className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {pending ? '…' : 'Re-pull keywords'}
          </button>
          <button
            type="button"
            onClick={onRetarget}
            disabled={pending || clusters.length === 0}
            className="rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {pending ? '…' : 'Re-target content'}
          </button>
          <button
            type="button"
            onClick={onGenerateLongform}
            disabled={pending}
            title="Regenerate just the keyword-rich long-form home intro from existing clusters. Leaves pages and the video untouched."
            className="rounded bg-violet-700 hover:bg-violet-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white"
          >
            {pending ? '…' : 'Generate long-form intro'}
          </button>
        </div>
      </header>

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
      )}

      {clusters.length === 0 ? (
        <p className="text-xs text-slate-500 rounded border border-dashed border-slate-700 bg-slate-900/20 p-3">
          No keyword clusters yet. Click <strong>Re-pull keywords</strong> to run keyword-planner — it'll fetch ~80 candidates from DataForSEO, cluster them via Claude, and persist to Sanity. After that, click <strong>Re-target content</strong> to regenerate the site's pages against the new clusters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-3 py-2 font-medium">Cluster</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Intent</th>
                <th className="px-3 py-2 font-medium">Primary</th>
                <th className="px-3 py-2 font-medium">Vol</th>
                <th className="px-3 py-2 font-medium">KD</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => {
                const isExpanded = expanded === c._id;
                return (
                  <ClusterRow
                    key={c._id}
                    cluster={c}
                    isExpanded={isExpanded}
                    onToggle={() => setExpanded(isExpanded ? null : c._id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClusterRow({
  cluster,
  isExpanded,
  onToggle,
}: {
  cluster: SanityKeywordClusterSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusClass = STATUS_STYLES[cluster.status] ?? 'bg-slate-700 text-slate-200';
  return (
    <>
      <tr
        className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-slate-500">{isExpanded ? '▼' : '▶'}</td>
        <td className="px-3 py-2 font-mono text-xs text-slate-400">{cluster.clusterKey}</td>
        <td className="px-3 py-2 text-xs">{KIND_LABELS[cluster.pageKind] ?? cluster.pageKind}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{cluster.intent}</td>
        <td className="px-3 py-2">{cluster.primaryKeyword}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{cluster.primaryVolume ?? '—'}</td>
        <td className="px-3 py-2 text-xs text-slate-400">{cluster.primaryKd ?? '—'}</td>
        <td className="px-3 py-2">
          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusClass}`}>
            {cluster.status}
          </span>
        </td>
      </tr>
      {isExpanded ? (
        <tr className="border-b border-slate-800/60 bg-slate-950/40">
          <td colSpan={8} className="px-3 py-3">
            <div className="text-xs text-slate-400 mb-2">
              {cluster.keywords.length} keywords · fetched{' '}
              {cluster.fetchedAt ? <Timestamp value={cluster.fetchedAt} mode="date" /> : '—'}
            </div>
            <div className="overflow-x-auto rounded border border-slate-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
                    <th className="px-2 py-1 font-medium">Phrase</th>
                    <th className="px-2 py-1 font-medium">Role</th>
                    <th className="px-2 py-1 font-medium">Vol</th>
                    <th className="px-2 py-1 font-medium">KD</th>
                    <th className="px-2 py-1 font-medium">Intent</th>
                    <th className="px-2 py-1 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.keywords.map((k, i) => (
                    <tr key={`${k.phrase}-${i}`} className="border-b border-slate-800/40 last:border-0">
                      <td className="px-2 py-1">{k.phrase}</td>
                      <td className="px-2 py-1 text-slate-400">{k.role ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-400">{k.searchVolume ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-400">{k.kd ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-400">{k.intent ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-400">{k.source ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
