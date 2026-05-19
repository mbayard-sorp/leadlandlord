'use client';

import { useTransition } from 'react';
import { forceDecideTrial } from './actions';

export function ForceDecideButtons({ trialId }: { trialId: string }) {
  const [pending, startTransition] = useTransition();

  function decide(decision: 'won' | 'lost') {
    const fd = new FormData();
    fd.append('trial_id', trialId);
    fd.append('decision', decision);
    startTransition(async () => {
      await forceDecideTrial(fd);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('won')}
        className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-2 py-1 rounded"
      >
        {pending ? '...' : 'Mark won'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('lost')}
        className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
      >
        Mark lost
      </button>
    </div>
  );
}
