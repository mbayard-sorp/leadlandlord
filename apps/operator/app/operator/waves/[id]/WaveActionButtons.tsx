'use client';

import { useTransition, useState } from 'react';
import { triggerWaveProgress, triggerWaveComplete } from '../actions';

interface Props {
  waveId: string;
}

export function WaveActionButtons({ waveId }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onProgress() {
    const fd = new FormData();
    fd.append('wave_id', waveId);
    startTransition(async () => {
      const result = await triggerWaveProgress(fd);
      setMessage(result.message ?? null);
    });
  }

  function onComplete() {
    if (!confirm('Force-complete this wave? This bypasses the normal pipeline checks.')) return;
    const fd = new FormData();
    fd.append('wave_id', waveId);
    startTransition(async () => {
      const result = await triggerWaveComplete(fd);
      setMessage(result.message ?? null);
    });
  }

  return (
    <div className="space-y-3">
      {message && (
        <p className="text-sm text-slate-400">{message}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={onProgress}
          className="text-sm bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          {pending ? '...' : 'Re-evaluate progress'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onComplete}
          className="text-sm bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"
        >
          Force complete
        </button>
      </div>
    </div>
  );
}
