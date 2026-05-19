'use client';

import { useTransition, useState } from 'react';
import { approveNiche, rejectNiche } from './actions';

interface Props {
  id: string;
  volumeSource: string;
}

export function DecisionButtons({ id, volumeSource }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const isEstimate = volumeSource === 'claude_estimate';

  function handleApproveClick() {
    if (isEstimate) {
      setConfirmingApprove(true);
    } else {
      doApprove();
    }
  }

  function doApprove() {
    setConfirmingApprove(false);
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
        <p className="text-xs text-amber-400 font-medium">Unvalidated — estimate only. Approve anyway?</p>
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
            onClick={() => setConfirmingApprove(false)}
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
