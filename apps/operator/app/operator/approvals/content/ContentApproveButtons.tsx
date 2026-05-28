'use client';

import { useState, useTransition } from 'react';
import { approveContentIdea, rejectContentIdea } from './actions';

export function ContentApproveButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onApprove() {
    setError(null);
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => {
      const res = await approveContentIdea(fd);
      // On success the action revalidates the queue and this row drops off. On
      // failure (e.g. an expired session returning {ok:false}) the row stays —
      // surface it instead of silently no-op'ing, which previously stranded
      // ideas as "pending" with no writer ever dispatched.
      if (!res?.ok) setError(res?.message ?? 'Approve failed — try again.');
    });
  }

  function onRejectConfirm() {
    setError(null);
    const fd = new FormData();
    fd.append('id', id);
    fd.append('rejection_reason', reason);
    startTransition(async () => {
      const res = await rejectContentIdea(fd);
      if (!res?.ok) setError(res?.message ?? 'Reject failed — try again.');
    });
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
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
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
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
