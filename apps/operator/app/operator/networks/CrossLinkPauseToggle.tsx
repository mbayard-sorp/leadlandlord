'use client';

import { useTransition } from 'react';
import { toggleCrossLinkPause } from './cross-link-actions';

interface Props {
  paused: boolean;
}

export function CrossLinkPauseToggle({ paused }: Props) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await toggleCrossLinkPause(!paused);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
          paused ? 'bg-amber-600' : 'bg-indigo-600'
        }`}
        role="switch"
        aria-checked={!paused}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
            paused ? 'translate-x-0' : 'translate-x-4'
          }`}
        />
      </button>
      <span className="text-sm text-slate-300">
        {pending ? '...' : paused ? 'Cross-links paused' : 'Cross-links live'}
      </span>
    </div>
  );
}
