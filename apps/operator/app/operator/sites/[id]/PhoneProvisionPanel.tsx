'use client';

import { useState, useTransition } from 'react';
import type { Site } from '@leadlandlord/db';
import {
  findPhoneCandidates,
  recommendNumber,
  provisionChosenNumber,
  type PhoneCandidateRow,
} from './phone-actions';
import { PhoneAssignmentForm } from './PhoneAssignmentForm';

interface Props {
  site: Site;
}

type PanelState = 'idle' | 'finding' | 'recommending' | 'provisioning' | 'done' | 'error';

/**
 * Guided Twilio phone-number provisioning panel.
 *
 * Flow:
 *   1. "Find phone numbers" → findPhoneCandidates → shows 5 candidates
 *   2. "Get AI recommendation" → recommendNumber → highlights the recommended pick
 *   3. "Provision this number" on any candidate → provisionChosenNumber → done
 *
 * Falls back to PhoneAssignmentForm (manual override) when Twilio returns zero
 * candidates or when the operator explicitly wants a specific number.
 */
export function PhoneProvisionPanel({ site }: Props) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [candidates, setCandidates] = useState<PhoneCandidateRow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [provisionedNumber, setProvisionedNumber] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const [isPending, startTransition] = useTransition();

  const alreadyProvisioned = !!site.trackingNumber && !!site.twilioPhoneSid;

  function handleFindCandidates() {
    startTransition(async () => {
      setPanelState('finding');
      setErrorMsg(null);
      const result = await findPhoneCandidates(site.id);
      if (!result.ok || !result.candidates) {
        setErrorMsg(result.message ?? 'Failed to find candidates.');
        // If zero candidates, surface manual override immediately
        setPanelState('error');
        setShowManual(true);
        return;
      }
      setCandidates(result.candidates);
      setPanelState('idle');
    });
  }

  function handleRecommend() {
    startTransition(async () => {
      setPanelState('recommending');
      setErrorMsg(null);
      const result = await recommendNumber(site.id);
      if (!result.ok || !result.candidates) {
        setErrorMsg(result.message ?? 'Recommendation failed.');
        setPanelState('error');
        return;
      }
      setCandidates(result.candidates);
      setPanelState('idle');
    });
  }

  function handleProvision(e164: string) {
    startTransition(async () => {
      setPanelState('provisioning');
      setErrorMsg(null);
      const result = await provisionChosenNumber(site.id, e164);
      if (!result.ok) {
        setErrorMsg(result.message ?? 'Provisioning failed.');
        setPanelState('error');
        return;
      }
      setProvisionedNumber(result.trackingNumber ?? e164);
      setPanelState('done');
    });
  }

  return (
    <div className="space-y-4">
      {/* Current state banner */}
      {alreadyProvisioned && panelState !== 'done' && (
        <div className="rounded border border-emerald-700/50 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Currently assigned: <span className="font-mono">{site.trackingNumber}</span>
          {site.twilioPhoneSid && (
            <span className="ml-2 text-xs text-emerald-500">SID: {site.twilioPhoneSid}</span>
          )}
        </div>
      )}

      {panelState === 'done' && provisionedNumber && (
        <div className="rounded border border-emerald-700/50 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Provisioned: <span className="font-mono">{provisionedNumber}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded border border-red-700/50 bg-red-900/20 px-4 py-2 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Step 1: Find candidates */}
      {!candidates && panelState !== 'done' && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5">
          <p className="text-sm text-slate-400 mb-4">
            Find available Twilio numbers for <strong className="text-slate-200">{site.city}</strong>.
            Returns up to 5 local numbers. AI will then recommend the best pick.
          </p>
          <button
            onClick={handleFindCandidates}
            disabled={isPending}
            className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {panelState === 'finding' || isPending ? 'Searching…' : 'Find phone numbers'}
          </button>
        </div>
      )}

      {/* Step 2 & 3: Candidates table */}
      {candidates && candidates.length > 0 && panelState !== 'done' && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-slate-200">
              Available numbers ({candidates.length})
            </h3>
            {/* Only show "Get recommendation" if none are recommended yet */}
            {!candidates.some((c) => c.recommended) && (
              <button
                onClick={handleRecommend}
                disabled={isPending}
                className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-white text-xs font-medium disabled:opacity-50"
              >
                {panelState === 'recommending' || isPending ? 'Asking AI…' : 'Get AI recommendation'}
              </button>
            )}
          </div>

          <ul className="space-y-2">
            {candidates.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                onProvision={handleProvision}
                disabled={isPending}
              />
            ))}
          </ul>

          <button
            onClick={handleFindCandidates}
            disabled={isPending}
            className="text-xs text-slate-500 hover:text-slate-300 underline"
          >
            Refresh candidates
          </button>
        </div>
      )}

      {/* Manual override toggle */}
      <div>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 underline"
        >
          {showManual ? 'Hide manual override' : 'Manual override'}
        </button>
        {showManual && (
          <div className="mt-3">
            <PhoneAssignmentForm site={site} />
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  onProvision,
  disabled,
}: {
  candidate: PhoneCandidateRow;
  onProvision: (e164: string) => void;
  disabled: boolean;
}) {
  const isRecommended = candidate.recommended;

  return (
    <li
      className={`rounded border px-4 py-3 flex items-start gap-3 ${
        isRecommended
          ? 'border-violet-600/60 bg-violet-900/20'
          : 'border-slate-700 bg-slate-900/20'
      }`}
    >
      {/* Sparkle badge for recommended */}
      <span className="shrink-0 mt-0.5 text-base" aria-hidden>
        {isRecommended ? '✦' : '○'}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-slate-100">{candidate.candidateE164}</span>
          {candidate.locality && (
            <span className="text-xs text-slate-500">{candidate.locality}</span>
          )}
          {candidate.region && (
            <span className="text-xs text-slate-600">{candidate.region}</span>
          )}
          {isRecommended && (
            <span className="text-xs font-medium text-violet-300 bg-violet-900/40 px-1.5 py-0.5 rounded border border-violet-600/40">
              Recommended
            </span>
          )}
        </div>

        {/* Rationale for recommended pick (always shown) */}
        {isRecommended && candidate.rationale && (
          <p className="mt-1 text-xs text-violet-300/80">{candidate.rationale}</p>
        )}

        {/* Runner-up rationale tucked in a details disclosure */}
        {!isRecommended && candidate.rationale && (
          <details className="mt-1">
            <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-400 select-none">
              Why this number?
            </summary>
            <p className="mt-1 text-xs text-slate-400 pl-3">{candidate.rationale}</p>
          </details>
        )}

        {/* Capabilities */}
        <div className="mt-1 flex gap-2">
          {candidate.capabilities && (
            <>
              <CapPill active={candidate.capabilities.voice} label="Voice" />
              <CapPill active={candidate.capabilities.sms} label="SMS" />
              <CapPill active={candidate.capabilities.mms} label="MMS" />
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => onProvision(candidate.candidateE164)}
        disabled={disabled}
        className="shrink-0 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
      >
        Provision
      </button>
    </li>
  );
}

function CapPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border ${
        active
          ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/20'
          : 'text-slate-600 border-slate-700 bg-transparent'
      }`}
    >
      {label}
    </span>
  );
}
