'use client';

import { useState, useTransition } from 'react';
import { approveContentIdea, rejectContentIdea } from './actions';

export function ContentApproveButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  function onApprove() {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => { await approveContentIdea(fd); });
  }

  function onRejectConfirm() {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('rejection_reason', reason);
    startTransition(async () => { await rejectContentIdea(fd); });
  }

  if (showReject) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[160px]">
        <input
          type="text"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={onRejectConfirm}
            className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
          >
            {pending ? '...' : 'Confirm'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowReject(false)}
            className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={onApprove}
        className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-2 py-1 rounded"
      >
        {pending ? '...' : 'Approve'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setShowReject(true)}
        className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
      >
        Reject
      </button>
    </div>
  );
}
