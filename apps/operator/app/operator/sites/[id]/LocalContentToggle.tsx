'use client';

import { useTransition } from 'react';
import { setLocalContentEnabled } from './actions';

interface Props {
  siteId: string;
  enabled: boolean;
}

export function LocalContentToggle({ siteId, enabled }: Props) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setLocalContentEnabled(siteId, !enabled);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
          enabled ? 'bg-indigo-600' : 'bg-slate-700'
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-sm text-slate-300">
        {pending ? '...' : enabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  );
}
