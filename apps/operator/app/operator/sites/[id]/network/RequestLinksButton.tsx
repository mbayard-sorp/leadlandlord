'use client';

import { useState, useTransition } from 'react';
import { requestNetworkLinks } from './network-actions';

interface Props {
  siteId: string;
  disabled?: boolean;
}

export function RequestLinksButton({ siteId, disabled }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onClick() {
    setMessage(null);
    startTransition(async () => {
      const res = await requestNetworkLinks(siteId);
      setMessage(res.message ?? (res.ok ? 'queued' : 'failed'));
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending || disabled}
        onClick={onClick}
        className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-600/20 px-3 py-1.5 text-sm font-medium text-indigo-200 hover:bg-indigo-600/30 disabled:opacity-50"
      >
        {pending ? 'Queuing…' : 'Request network links'}
      </button>
      {message && <span className="text-xs text-slate-400">{message}</span>}
    </div>
  );
}
