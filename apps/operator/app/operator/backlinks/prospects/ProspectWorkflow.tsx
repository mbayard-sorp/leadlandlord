'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePolledFetch } from '../../../../lib/use-polled-fetch';
import { SiteCombobox } from './SiteCombobox';
import { SeedEditor } from './SeedEditor';
import { StepStatusPill } from './StepStatusPill';
import { ProspectTable } from './ProspectTable';
import { MollyTop5Section } from './MollyTop5';
import { runMollyForSite } from './molly-run-action';
import type { Backlink, BacklinkProspect } from '@leadlandlord/db';

type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'budget_exceeded';

interface StatusResponse {
  ok: boolean;
  siteId: string;
  competitorSeeds: string[];
  runningOrQueued: boolean;
  prospectRun: {
    status: RunStatus;
    progressMessage: string | null;
    progressStep: number | null;
    progressTotal: number | null;
    lastRunAt: string | null;
    discovered: number | null;
    enriched: number | null;
    created: number | null;
    error: string | null;
  };
  mollyRun: {
    status: RunStatus;
    progressMessage: string | null;
    lastRunAt: string | null;
    top5Count: number;
    pendingApprovalCount: number;
    error: string | null;
  };
  prospects: {
    rows: Backlink[];
  };
}

interface PicksResponse {
  ok: boolean;
  siteId: string;
  rows: BacklinkProspect[];
}

function StepCard({
  step,
  title,
  pill,
  open,
  onToggle,
  children,
}: {
  step: number;
  title: string;
  pill?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-900/60"
      >
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-slate-700 text-xs font-mono text-slate-300 flex items-center justify-center shrink-0">
            {step}
          </span>
          <span className="text-sm font-medium text-slate-200">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {pill}
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-slate-800">{children}</div>}
    </div>
  );
}

export function ProspectWorkflow() {
  const router = useRouter();
  const [siteId, setSiteId] = useState<string>('');
  const [openStep, setOpenStep] = useState<number>(1);
  const [step6Open, setStep6Open] = useState(false);
  const [maxApollo, setMaxApollo] = useState<number>(5);

  const [mollyPending, startMollyTransition] = useTransition();
  const [runPending, startRunTransition] = useTransition();
  const [mollyMsg, setMollyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const statusUrl = siteId ? `/api/operator/prospects/${siteId}/status` : '';
  const picksUrl = siteId && step6Open ? `/api/operator/prospects/${siteId}/picks` : '';

  const { data: statusData, loading: statusLoading } = usePolledFetch<StatusResponse>(
    statusUrl,
    { enabled: !!siteId },
  );

  const { data: picksData } = usePolledFetch<PicksResponse>(picksUrl, {
    enabled: !!picksUrl,
    intervalMs: 8000,
  });

  const prospectRun = statusData?.prospectRun;
  const mollyRun = statusData?.mollyRun;
  const prospectRows = statusData?.prospects.rows ?? [];
  const seeds = statusData?.competitorSeeds ?? [];
  const picks = picksData?.rows ?? [];

  const runButtonDisabled = runPending || !siteId || !!statusData?.runningOrQueued;

  const mollyLastRunAt = mollyRun?.lastRunAt ? new Date(mollyRun.lastRunAt) : null;
  const mollyRanToday =
    mollyLastRunAt != null &&
    mollyLastRunAt.toDateString() === new Date().toDateString();
  const mollyTimeLabel = mollyLastRunAt
    ? mollyLastRunAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  function handleSiteSelect(id: string) {
    setSiteId(id);
    setOpenStep(2);
    setRunMsg(null);
    setMollyMsg(null);
  }

  function toggleStep(n: number) {
    setOpenStep((prev) => (prev === n ? 0 : n));
  }

  function runProspect() {
    if (!siteId) return;
    setRunMsg(null);
    startRunTransition(async () => {
      const { requestProspectRun } = await import('../actions');
      const r = await requestProspectRun({ siteId, maxApolloEnrichments: maxApollo });
      if (r.ok) {
        setRunMsg({ ok: true, text: 'Run queued — polling for progress…' });
        setOpenStep(3);
      } else {
        setRunMsg({ ok: false, text: r.message ?? 'run failed' });
      }
    });
  }

  function runMolly() {
    if (!siteId) return;
    setMollyMsg(null);
    startMollyTransition(async () => {
      const r = await runMollyForSite(siteId);
      setMollyMsg({ ok: r.ok, text: r.ok ? 'Molly started' : (r.message ?? 'failed') });
      if (r.ok) {
        router.refresh();
        setStep6Open(true);
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Step 1 */}
      <StepCard
        step={1}
        title="Select site"
        open={openStep === 1}
        onToggle={() => toggleStep(1)}
        pill={siteId ? <span className="text-xs text-emerald-400">selected</span> : undefined}
      >
        <div className="mt-2 max-w-sm">
          <SiteCombobox onSelect={handleSiteSelect} selectedId={siteId} />
        </div>
      </StepCard>

      {/* Step 2 */}
      <StepCard
        step={2}
        title="Confirm competitor seeds"
        open={openStep === 2}
        onToggle={() => toggleStep(2)}
        pill={
          !siteId ? (
            <span className="text-xs text-slate-500">select a site first</span>
          ) : seeds.length > 0 ? (
            <span className="text-xs text-slate-400">{seeds.length} seeds</span>
          ) : undefined
        }
      >
        {siteId && !statusLoading ? (
          <div className="mt-2">
            <SeedEditor siteId={siteId} seeds={seeds} />
          </div>
        ) : siteId ? (
          <p className="text-sm text-slate-500 mt-2">Loading…</p>
        ) : (
          <p className="text-sm text-slate-500 mt-2">Select a site in Step 1 first.</p>
        )}
      </StepCard>

      {/* Step 3 */}
      <StepCard
        step={3}
        title="Discover prospects"
        open={openStep === 3}
        onToggle={() => toggleStep(3)}
        pill={
          prospectRun && prospectRun.status !== 'idle' ? (
            <StepStatusPill
              status={prospectRun.status}
              progressMessage={prospectRun.progressMessage}
              progressStep={prospectRun.progressStep}
              progressTotal={prospectRun.progressTotal}
              lastRunAt={prospectRun.lastRunAt}
              error={prospectRun.error}
              onRetry={runProspect}
            />
          ) : undefined
        }
      >
        <div className="mt-2 space-y-3">
          <div className="flex items-end gap-3">
            <label className="text-xs text-slate-400 space-y-1">
              <span>
                Max Apollo enrichments{' '}
                <span className="text-slate-500">(1 credit each)</span>
              </span>
              <input
                type="number"
                min={1}
                max={75}
                value={maxApollo}
                onChange={(e) =>
                  setMaxApollo(Math.max(1, Math.min(75, Number(e.target.value) || 1)))
                }
                className="block w-24 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200"
              />
            </label>
            <button
              type="button"
              onClick={runProspect}
              disabled={runButtonDisabled}
              className="text-xs px-3 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700/80 text-sky-100 disabled:opacity-50"
            >
              {runPending
                ? 'Running…'
                : statusData?.runningOrQueued
                ? 'Running…'
                : 'Run'}
            </button>
          </div>
          {runMsg && (
            <p className={`text-xs ${runMsg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {runMsg.text}
            </p>
          )}
          {prospectRun?.status === 'succeeded' &&
            prospectRun.discovered != null && (
              <p className="text-xs text-slate-400">
                Last run: {prospectRun.discovered} discovered, {prospectRun.enriched ?? 0}{' '}
                enriched, {prospectRun.created ?? 0} created
              </p>
            )}
        </div>
      </StepCard>

      {/* Step 4 */}
      <StepCard
        step={4}
        title="Review prospects"
        open={openStep === 4}
        onToggle={() => toggleStep(4)}
        pill={
          prospectRows.length > 0 ? (
            <span className="text-xs text-slate-400">{prospectRows.length} rows</span>
          ) : undefined
        }
      >
        {siteId ? (
          <div className="mt-2">
            <ProspectTable rows={prospectRows} hideSiteColumn />
          </div>
        ) : (
          <p className="text-sm text-slate-500 mt-2">Select a site first.</p>
        )}
      </StepCard>

      {/* Step 5 */}
      <StepCard
        step={5}
        title="Score with Molly"
        open={openStep === 5}
        onToggle={() => toggleStep(5)}
        pill={
          mollyRun && mollyRun.status !== 'idle' ? (
            <StepStatusPill
              status={mollyRun.status}
              progressMessage={mollyRun.progressMessage}
              lastRunAt={mollyRun.lastRunAt}
              error={mollyRun.error}
              onRetry={runMolly}
            />
          ) : undefined
        }
      >
        <div className="mt-2 space-y-3">
          {mollyRanToday && mollyTimeLabel && (
            <p className="text-xs text-amber-300">
              Molly last ran today at {mollyTimeLabel} — re-run?
            </p>
          )}
          <button
            type="button"
            onClick={runMolly}
            disabled={mollyPending || !siteId || mollyRun?.status === 'running'}
            className="text-xs px-3 py-1.5 rounded bg-violet-700/50 hover:bg-violet-700/70 text-violet-100 disabled:opacity-50"
          >
            {mollyPending ? 'Starting…' : 'Run Molly'}
          </button>
          {mollyMsg && (
            <p className={`text-xs ${mollyMsg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {mollyMsg.text}
            </p>
          )}
        </div>
      </StepCard>

      {/* Step 6 */}
      <StepCard
        step={6}
        title="Approve Molly's picks"
        open={step6Open}
        onToggle={() => setStep6Open((prev) => !prev)}
        pill={
          mollyRun && mollyRun.top5Count > 0 ? (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-violet-700/60 text-violet-200">
              {mollyRun.top5Count}
            </span>
          ) : undefined
        }
      >
        {siteId ? (
          picks.length > 0 ? (
            <div className="mt-2">
              <MollyTop5Section prospects={picks} siteLabelMap={{}} />
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-2">
              No picks yet. Run Molly on Step 5 to score prospects.
            </p>
          )
        ) : (
          <p className="text-sm text-slate-500 mt-2">Select a site first.</p>
        )}
      </StepCard>
    </div>
  );
}
