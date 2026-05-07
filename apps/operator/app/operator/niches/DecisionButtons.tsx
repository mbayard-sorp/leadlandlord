'use client';

import { useTransition } from 'react';
import { approveNiche, rejectNiche } from './actions';

interface Props {
  id: string;
}

export function DecisionButtons({ id }: Props) {
  const [pending, startTransition] = useTransition();
  function on(action: 'approve' | 'reject') {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => {
      if (action === 'approve') await approveNiche(fd);
      else await rejectNiche(fd);
    });
  }
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => on('approve')}
        className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
      >
        {pending ? '…' : 'Approve'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => on('reject')}
        className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
      >
        Reject
      </button>
    </div>
  );
}
