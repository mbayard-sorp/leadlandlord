'use client';

import { useState, useTransition } from 'react';
import {
  promoteSiteToLive,
  setGoLiveFlag,
  type GoLiveManualFlags,
} from './go-live-actions';

export interface GoLiveItem {
  key: string;
  label: string;
  hint?: string;
  done: boolean;
  /** If set, render a manual checkbox the operator toggles via server action. */
  manual?: 'gscSubmittedAt' | 'gbpClaimedAt';
}

interface Props {
  siteId: string;
  /** Current site status. Used to decide whether to render collapsed. */
  status: string;
  items: GoLiveItem[];
  manualFlags: GoLiveManualFlags;
}

/**
 * Go-live checklist surfaced under the Theme rail. Auto-derived items reflect
 * upstream state (deployment, domain, tracking phone, etc.); manual items
 * persist as ISO timestamps in `sites.metadata.goLive`. Once `status='live'`
 * the whole panel renders as a collapsed `<details>` summary so it stops
 * dominating the page.
 */
export function GoLiveChecklist({ siteId, status, items, manualFlags }: Props) {
  const allDone = items.every((i) => i.done);
  const doneCount = items.filter((i) => i.done).length;
  const isLive = status === 'live';

  const summary = (
    <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
      <span>Go-live checklist</span>
      <span
        className={`text-xs px-2 py-0.5 rounded border ${
          allDone
            ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50'
            : 'bg-amber-900/30 text-amber-300 border-amber-700/50'
        }`}
      >
        {doneCount}/{items.length}
      </span>
      {isLive && (
        <span className="text-xs px-2 py-0.5 rounded border bg-emerald-900/30 text-emerald-300 border-emerald-700/50">
          LIVE
        </span>
      )}
    </span>
  );

  // Collapsed by default when the site is already live; expanded otherwise so
  // the operator sees the remaining work without an extra click.
  if (isLive) {
    return (
      <details className="group rounded-lg border border-slate-800 bg-slate-900/40">
        <summary className="cursor-pointer list-none flex items-center justify-between px-5 py-3">
          {summary}
          <span className="text-slate-500 text-xs group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <div className="px-5 pb-5 pt-1">
          <Body siteId={siteId} items={items} manualFlags={manualFlags} allDone={allDone} isLive={isLive} />
        </div>
      </details>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <div className="flex items-center justify-between">
        {summary}
      </div>
      <Body siteId={siteId} items={items} manualFlags={manualFlags} allDone={allDone} isLive={isLive} />
    </div>
  );
}

function Body({
  siteId,
  items,
  manualFlags,
  allDone,
  isLive,
}: {
  siteId: string;
  items: GoLiveItem[];
  manualFlags: GoLiveManualFlags;
  allDone: boolean;
  isLive: boolean;
}) {
  return (
    <>
      <ul className="space-y-2">
        {items.map((item) => (
          <ChecklistRow key={item.key} siteId={siteId} item={item} manualFlags={manualFlags} />
        ))}
      </ul>
      {!isLive && (
        <PromoteButton siteId={siteId} disabled={!allDone} />
      )}
    </>
  );
}

function ChecklistRow({
  siteId,
  item,
  manualFlags,
}: {
  siteId: string;
  item: GoLiveItem;
  manualFlags: GoLiveManualFlags;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);

  const done = optimisticDone ?? item.done;

  function toggle() {
    if (!item.manual) return;
    const next = !done;
    setOptimisticDone(next);
    startTransition(async () => {
      const r = await setGoLiveFlag(siteId, item.manual!, next);
      if (!r.ok) setOptimisticDone(null);
    });
  }

  const flagTimestamp = item.manual ? manualFlags[item.manual] : null;

  return (
    <li className="flex items-start gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={!item.manual || pending}
        className={`inline-flex items-center justify-center rounded border text-xs ${
          item.manual ? 'min-h-[44px] min-w-[44px]' : 'h-5 w-5 mt-0.5'
        } ${
          done
            ? 'bg-emerald-900/40 border-emerald-600/60 text-emerald-300'
            : 'bg-slate-900/60 border-slate-700 text-slate-600'
        } ${item.manual && !pending ? 'hover:border-slate-500 cursor-pointer' : ''} ${
          !item.manual ? 'cursor-default' : ''
        }`}
        aria-label={item.manual ? `Toggle ${item.label}` : `${item.label} (auto-derived)`}
      >
        <span className={item.manual ? 'text-base' : ''}>{done ? '✓' : ''}</span>
      </button>
      <div className={`flex-1 text-sm ${item.manual ? 'pt-2.5' : ''}`}>
        <div className="text-slate-200 flex items-center gap-2">
          {item.label}
          {!item.manual && (
            <span className="text-[10px] uppercase tracking-wide text-slate-600">auto</span>
          )}
        </div>
        {item.hint && <div className="text-xs text-slate-500 mt-0.5">{item.hint}</div>}
        {flagTimestamp && (
          <div className="text-xs text-slate-600 mt-0.5">
            Checked {new Date(flagTimestamp).toLocaleString()}
          </div>
        )}
      </div>
    </li>
  );
}

function PromoteButton({ siteId, disabled }: { siteId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function promote() {
    setMsg(null);
    startTransition(async () => {
      const r = await promoteSiteToLive(siteId);
      setMsg(r.ok ? 'Site is now live.' : r.message ?? 'promote failed');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-800">
      <button
        type="button"
        onClick={promote}
        disabled={disabled || pending}
        className="inline-flex items-center min-h-[44px] text-sm px-4 rounded bg-emerald-700/50 hover:bg-emerald-700/70 text-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {pending ? 'Promoting…' : 'Mark site as live'}
      </button>
      {disabled && (
        <span className="text-xs text-slate-500">
          Finish the remaining items above to enable.
        </span>
      )}
      {msg && <span className="text-xs text-amber-300">{msg}</span>}
    </div>
  );
}
