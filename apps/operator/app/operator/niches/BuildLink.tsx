'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { findSiteForNiche, getNicheBuildStatus, requeueNicheBuild, type NicheBuildStatus } from './actions';

interface Props {
  nicheId: string;
  initialSiteId: string | null;
  /** Pre-fetched build status from the server render. Avoids a flash of
   *  "building..." for niches that are already in a terminal failed state. */
  initialBuildStatus?: NicheBuildStatus | null;
}

/**
 * For approved niches, shows the current build state:
 *  - site exists => "View build ->" link (stops polling)
 *  - queued/running => animated pulse "building..."
 *  - stale after 15 min with no site => amber "stale" badge
 *  - dead-lettered event => red "dead-letter" badge + Retry button
 *  - build_failed / compliance_blocked site status => red badge + Retry
 *  - event failed => red "failed" badge + Retry
 *
 * Polls every 5s while in a non-terminal transitional state.
 */
export function BuildLink({ nicheId, initialSiteId, initialBuildStatus }: Props) {
  const [siteId, setSiteId] = useState<string | null>(initialSiteId);
  const [buildStatus, setBuildStatus] = useState<NicheBuildStatus | null>(initialBuildStatus ?? null);
  const [isPending, startTransition] = useTransition();

  // Derive whether we need to keep polling.
  const isTerminal =
    !!siteId ||
    buildStatus?.eventState === 'dead_letter' ||
    buildStatus?.siteStatus === 'build_failed' ||
    buildStatus?.siteStatus === 'compliance_blocked';

  useEffect(() => {
    if (isTerminal) return;

    let cancelled = false;

    async function tick() {
      const [siteResult, statusResult] = await Promise.all([
        findSiteForNiche(nicheId),
        getNicheBuildStatus(nicheId),
      ]);
      if (cancelled) return;
      if (siteResult.siteId) setSiteId(siteResult.siteId);
      setBuildStatus(statusResult);
    }

    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [nicheId, isTerminal]);

  function handleRetry() {
    startTransition(async () => {
      await requeueNicheBuild(nicheId);
      // Immediately re-fetch so the UI clears the dead-letter badge.
      const [siteResult, statusResult] = await Promise.all([
        findSiteForNiche(nicheId),
        getNicheBuildStatus(nicheId),
      ]);
      setSiteId(siteResult.siteId);
      setBuildStatus(statusResult);
    });
  }

  // --- Render ---

  if (siteId) {
    return (
      <Link
        href={`/operator/sites/${siteId}`}
        className="inline-flex items-center gap-1 rounded border border-indigo-700 px-2 py-0.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/40"
      >
        View build →
      </Link>
    );
  }

  // Dead-lettered event.
  if (buildStatus?.eventState === 'dead_letter') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 rounded border border-red-900 bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
          dead-letter
        </span>
        {buildStatus.eventError && (
          <span className="max-w-[140px] text-[10px] text-red-400 break-words leading-tight">
            {buildStatus.eventError}
          </span>
        )}
        <RetryButton onClick={handleRetry} isPending={isPending} />
      </div>
    );
  }

  // build_failed or compliance_blocked site status.
  if (
    buildStatus?.siteStatus === 'build_failed' ||
    buildStatus?.siteStatus === 'compliance_blocked'
  ) {
    const label = buildStatus.siteStatus === 'compliance_blocked' ? 'compliance blocked' : 'build failed';
    const errorText = buildStatus.siteLastBuildError ?? buildStatus.runError;
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 rounded border border-red-900 bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
          {label}
        </span>
        {errorText && (
          <span className="max-w-[140px] text-[10px] text-red-400 break-words leading-tight">
            {errorText}
          </span>
        )}
        <RetryButton onClick={handleRetry} isPending={isPending} />
      </div>
    );
  }

  // Event failed (processed with error but not dead-lettered — will retry).
  if (buildStatus?.eventState === 'failed') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 rounded border border-red-800 bg-red-950/30 px-2 py-0.5 text-xs font-medium text-red-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
          failed
        </span>
        {buildStatus.eventError && (
          <span className="max-w-[140px] text-[10px] text-red-400 break-words leading-tight">
            {buildStatus.eventError}
          </span>
        )}
      </div>
    );
  }

  // Stale: event is >15 min old with no site and no failure signal yet.
  if (buildStatus?.stale) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 rounded border border-amber-800 bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          stale
        </span>
        <RetryButton onClick={handleRetry} isPending={isPending} />
      </div>
    );
  }

  // In-flight: queued or running.
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
      building…
    </span>
  );
}

function RetryButton({ onClick, isPending }: { onClick: () => void; isPending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
    >
      {isPending ? 'Retrying…' : 'Retry Build'}
    </button>
  );
}
