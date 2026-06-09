'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { approveProspect, rejectProspect, snoozeProspect, setProspectContact } from '@/lib/links/prospect-actions';
import { requestProspectRun } from '@/lib/links/run-actions';
import { ReasonChips } from '@/components/ReasonChips';
import type { BacklinkProspect } from '@leadlandlord/db';

interface Prospect extends BacklinkProspect {
  siteLabel: string;
}

interface Props {
  prospects: Prospect[];
}

type Decision = 'approve' | 'reject' | 'snooze' | null;

export function ReviewSession({ prospects }: Props) {
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected' | 'snoozed'>>(
    {},
  );
  const [expandRationale, setExpandRationale] = useState(false);
  const [activeDecision, setActiveDecision] = useState<Decision>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Inline contact edit state
  const [editEmail, setEditEmail] = useState('');
  const [editName, setEditName] = useState('');
  const [contactSaved, setContactSaved] = useState(false);
  const [contactPending, startContactTransition] = useTransition();

  // Run scout
  const [runPending, startRunTransition] = useTransition();
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const current = prospects[index];
  const totalDone = Object.keys(decisions).length;
  const totalApproved = Object.values(decisions).filter((d) => d === 'approved').length;
  const totalRejected = Object.values(decisions).filter((d) => d === 'rejected').length;
  const totalSnoozed = Object.values(decisions).filter((d) => d === 'snoozed').length;

  useEffect(() => {
    if (!current) return;
    const md = (current.metadata ?? {}) as Record<string, unknown>;
    const contactState = current.contactState ?? (md.contactState as string | undefined);
    if (contactState === 'guessed' || contactState === 'missing' || !current.contactEmail) {
      setEditEmail(current.contactEmail ?? '');
      setEditName(current.contactName ?? '');
    } else {
      setEditEmail('');
      setEditName('');
    }
    setContactSaved(false);
    setActiveDecision(null);
    setExpandRationale(false);
    setMsg(null);
  }, [current?.id]);

  // Keyboard shortcuts
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!current || pending) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'a' || e.key === 'A') setActiveDecision('approve');
      if (e.key === 'r' || e.key === 'R') setActiveDecision('reject');
      if (e.key === 's' || e.key === 'S') setActiveDecision('snooze');
    },
    [current, pending],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (prospects.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No prospects awaiting review.
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="text-sm text-slate-300 mb-3">Run scout now</p>
          <p className="text-xs text-slate-500 mb-3">
            Queue a prospect run for any site. The results will appear here once Molly scores them.
          </p>
          {runMsg && (
            <p className={`text-xs mb-2 ${runMsg.startsWith('Run') ? 'text-emerald-300' : 'text-amber-300'}`}>
              {runMsg}
            </p>
          )}
          <button
            type="button"
            disabled={runPending}
            onClick={() => {
              const siteId = prompt('Site ID to scout?');
              if (!siteId) return;
              setRunMsg(null);
              startRunTransition(async () => {
                const r = await requestProspectRun({ siteId });
                setRunMsg(r.ok ? 'Run queued.' : r.message ?? 'failed');
              });
            }}
            className="text-xs px-3 py-1.5 rounded bg-sky-700/50 hover:bg-sky-700/70 text-sky-100 disabled:opacity-50"
          >
            {runPending ? 'Queuing…' : 'Run scout now'}
          </button>
        </div>
      </div>
    );
  }

  // End state
  if (totalDone >= prospects.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center space-y-4">
        <div className="text-lg font-semibold text-slate-200">
          {totalDone} of {prospects.length} reviewed
        </div>
        <div className="flex justify-center gap-6 text-sm">
          <span>
            <span className="text-emerald-300 font-bold">{totalApproved}</span>{' '}
            <span className="text-slate-400">approved</span>
          </span>
          <span>
            <span className="text-red-300 font-bold">{totalRejected}</span>{' '}
            <span className="text-slate-400">rejected</span>
          </span>
          <span>
            <span className="text-slate-300 font-bold">{totalSnoozed}</span>{' '}
            <span className="text-slate-400">snoozed</span>
          </span>
        </div>
        <a
          href="/operator/links"
          className="inline-block text-xs px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
        >
          Back to hub
        </a>
      </div>
    );
  }

  if (!current) return null;

  const md = (current.metadata ?? {}) as Record<string, unknown>;
  const contactState =
    current.contactState ?? (typeof md.contactState === 'string' ? md.contactState : 'missing');
  const needsContact =
    contactState === 'missing' || contactState === 'guessed' || !current.contactEmail;
  const canApprove = !needsContact || contactSaved || (editEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail));

  const score = current.score != null ? Number(current.score) : null;
  const scoreColor =
    score == null ? 'text-slate-400' : score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-sky-400' : 'text-amber-400';

  const receptivity = (md.receptivity as Record<string, unknown> | undefined) ?? {};
  const signals = Array.isArray(receptivity.signals) ? (receptivity.signals as string[]) : [];
  const da = typeof md.domainRank === 'number' ? md.domainRank : current.domainRank;

  function recordDecision(d: 'approved' | 'rejected' | 'snoozed') {
    setDecisions((prev) => ({ ...prev, [current!.id]: d }));
    setActiveDecision(null);
    setMsg(null);
    // Move to next un-decided prospect
    const nextIdx = prospects.findIndex((p, i) => i > index && !decisions[p.id]);
    setIndex(nextIdx >= 0 ? nextIdx : prospects.length);
  }

  function handleApprove() {
    if (!canApprove || !current) return;
    setMsg(null);
    const emailToUse = contactSaved || current.contactEmail ? current.contactEmail! : editEmail;
    startTransition(async () => {
      const r = await approveProspect(current!.id, emailToUse || undefined);
      if (!r.ok) setMsg(r.message ?? 'approve failed');
      else recordDecision('approved');
    });
  }

  function handleReject(reason: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await rejectProspect(current!.id, reason);
      if (!r.ok) setMsg(r.message ?? 'reject failed');
      else recordDecision('rejected');
    });
  }

  function handleSnooze(days: number) {
    setMsg(null);
    startTransition(async () => {
      const r = await snoozeProspect(current!.id, days);
      if (!r.ok) setMsg(r.message ?? 'snooze failed');
      else recordDecision('snoozed');
    });
  }

  function saveContact() {
    if (!editEmail) return;
    startContactTransition(async () => {
      const r = await setProspectContact(current!.id, editEmail, editName || undefined);
      if (r.ok) setContactSaved(true);
      else setMsg(r.message ?? 'save failed');
    });
  }

  const progressDone = Object.keys(decisions);

  return (
    <div className="space-y-4 pb-32">
      {/* Progress header */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">
          Reviewing prospect{' '}
          <span className="text-slate-200 font-medium">{index + 1}</span> of{' '}
          {prospects.length}
        </span>
        <div className="flex gap-1">
          {prospects.map((p, i) => (
            <span
              key={p.id}
              className={`w-2.5 h-2.5 rounded-full ${
                progressDone.includes(p.id)
                  ? 'bg-emerald-500'
                  : i === index
                  ? 'ring-2 ring-sky-500 bg-slate-700'
                  : 'bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Prospect card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 space-y-4">
        {/* Domain + site chip */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl text-slate-100">{current.domain}</span>
            <a
              href={`https://${current.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-500 hover:text-sky-400"
            >
              ↗
            </a>
          </div>
          <span className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-400">
            {current.siteLabel}
          </span>
        </div>

        {/* Score + chips row */}
        <div className="flex flex-wrap items-center gap-3">
          {score != null && (
            <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{score.toFixed(0)}</span>
          )}
          {da != null && (
            <span className="text-xs px-2 py-0.5 rounded border border-slate-700 text-slate-300">
              DA {da}
            </span>
          )}
          {signals.map((s) => (
            <span
              key={s}
              className="text-xs px-2 py-0.5 rounded border border-emerald-800/60 bg-emerald-900/20 text-emerald-300"
            >
              {s}
            </span>
          ))}
        </div>

        {/* Rationale */}
        {current.rationale && (
          <div className="text-sm text-slate-300">
            <div className={expandRationale ? '' : 'line-clamp-3'}>{current.rationale}</div>
            {current.rationale.length > 200 && (
              <button
                type="button"
                onClick={() => setExpandRationale((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-300 mt-1"
              >
                {expandRationale ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {/* Contact block */}
        <div className="rounded border border-slate-700 bg-slate-900/60 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Contact:</span>
            {current.contactEmail && contactState === 'found' ? (
              <>
                <span className="font-mono text-slate-200">{current.contactEmail}</span>
                {current.contactName && (
                  <span className="text-slate-400">{current.contactName}</span>
                )}
                <span className="px-1.5 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
                  found
                </span>
              </>
            ) : (
              <span
                className={`px-1.5 py-0.5 rounded border text-xs ${
                  contactState === 'guessed'
                    ? 'border-amber-700/50 bg-amber-900/30 text-amber-300'
                    : 'border-red-700/50 bg-red-900/30 text-red-300'
                }`}
              >
                {contactState === 'guessed' ? 'guessed' : 'missing'}
              </span>
            )}
          </div>

          {needsContact && !contactSaved && (
            <div className="space-y-1.5">
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="editor@example.com"
                className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
              />
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Contact name (optional)"
                className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
              />
              <button
                type="button"
                onClick={saveContact}
                disabled={!editEmail || contactPending}
                className="text-xs px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
              >
                {contactPending ? 'Saving…' : 'Save contact'}
              </button>
              {contactSaved && (
                <span className="text-xs text-emerald-300 ml-2">Saved</span>
              )}
            </div>
          )}

          {contactSaved && (
            <div className="text-xs text-emerald-300">Contact saved: {editEmail}</div>
          )}
        </div>

        {msg && <p className="text-xs text-amber-300">{msg}</p>}
      </div>

      {/* Snooze popover */}
      {activeDecision === 'snooze' && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-2">
          <p className="text-xs text-slate-400">Snooze for how long?</p>
          <div className="flex gap-2">
            {[
              { label: '1 week', days: 7 },
              { label: '1 month', days: 30 },
              { label: '3 months', days: 90 },
            ].map(({ label, days }) => (
              <button
                key={days}
                type="button"
                disabled={pending}
                onClick={() => handleSnooze(days)}
                className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveDecision(null)}
              className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-500 hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reject chips */}
      {activeDecision === 'reject' && (
        <ReasonChips
          onConfirm={handleReject}
          onCancel={() => setActiveDecision(null)}
          pending={pending}
          label="Why are you rejecting this prospect?"
        />
      )}

      {/* Sticky decision bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-40">
        <div className="max-w-6xl mx-auto flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleApprove}
            disabled={!canApprove || pending || activeDecision === 'approve'}
            title={!canApprove ? 'Add contact email before approving' : undefined}
            className="flex-1 sm:flex-none text-sm px-4 py-2 rounded bg-emerald-700/50 hover:bg-emerald-700/70 text-emerald-100 disabled:opacity-40 font-medium"
          >
            {pending && activeDecision === 'approve' ? 'Approving…' : 'Approve'}
            <span className="hidden sm:inline ml-1.5 text-xs opacity-50">[A]</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveDecision((d) => (d === 'snooze' ? null : 'snooze'))}
            disabled={pending}
            className="flex-1 sm:flex-none text-sm px-4 py-2 rounded border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40"
          >
            Snooze
            <span className="hidden sm:inline ml-1.5 text-xs opacity-50">[S]</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveDecision((d) => (d === 'reject' ? null : 'reject'))}
            disabled={pending}
            className="flex-1 sm:flex-none text-sm px-4 py-2 rounded border border-red-800/60 text-red-300 hover:border-red-700 hover:bg-red-900/20 disabled:opacity-40"
          >
            Reject
            <span className="hidden sm:inline ml-1.5 text-xs opacity-50">[R]</span>
          </button>

          {!canApprove && (
            <span className="text-xs text-amber-300 hidden sm:block">
              Add contact email to enable Approve
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
