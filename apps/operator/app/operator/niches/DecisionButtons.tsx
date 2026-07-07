'use client';

import { useTransition, useState } from 'react';
import { approveNiche, rejectNiche, getNicheApprovalWarning } from './actions';

interface Props {
  id: string;
  validatedAt: Date | null;
  dfsFallback?: boolean | null;
}

export function DecisionButtons({ id, validatedAt, dfsFallback }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [diversityWarning, setDiversityWarning] = useState<string | null>(null);
  const isUnvalidated = validatedAt == null;
  const isUnmeasured = !isUnvalidated && !!dfsFallback;
  const needsDataConfirm = isUnvalidated || isUnmeasured;

  const dataConfirmCopy = isUnvalidated
    ? 'Unvalidated — estimate only. Approve anyway?'
    : 'Competition was not measured (SERP lookup failed). Approve anyway?';

  function handleApproveClick() {
    startTransition(async () => {
      // Portfolio concentration is non-blocking — it only ever adds to the
      // confirm dialog copy, never prevents the approval from proceeding.
      const warning = await getNicheApprovalWarning(id);
      if (warning.shouldWarn) setDiversityWarning(warning.message);
      if (needsDataConfirm || warning.shouldWarn) {
        setConfirmingApprove(true);
      } else {
        doApprove();
      }
    });
  }

  function doApprove() {
    setConfirmingApprove(false);
    setDiversityWarning(null);
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => {
      await approveNiche(fd);
    });
  }

  function handleReject() {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => {
      await rejectNiche(fd);
    });
  }

  if (confirmingApprove) {
    return (
      <div className="flex flex-col gap-1">
        {needsDataConfirm && <p className="text-xs text-amber-400 font-medium">{dataConfirmCopy}</p>}
        {diversityWarning && (
          <p className="text-xs text-sky-400 font-medium">{diversityWarning}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={doApprove}
            className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
          >
            {pending ? '…' : 'Yes, approve'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setConfirmingApprove(false);
              setDiversityWarning(null);
            }}
            className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleApproveClick}
        className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
      >
        {pending ? '…' : 'Approve'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={handleReject}
        className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
      >
        Reject
      </button>
    </div>
  );
}
