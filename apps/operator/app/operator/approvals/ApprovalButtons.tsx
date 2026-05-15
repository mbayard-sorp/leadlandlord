'use client';

import { useTransition } from 'react';
import { approveApproval, rejectApproval } from './actions';

export function ApprovalButtons({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function onApprove() {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('operator_email', 'operator');
    startTransition(async () => { await approveApproval(fd); });
  }

  function onReject() {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('operator_email', 'operator');
    startTransition(async () => { await rejectApproval(fd); });
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
        onClick={onReject}
        className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
      >
        Reject
      </button>
    </div>
  );
}
