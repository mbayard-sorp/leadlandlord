'use client';

import { useState, useTransition } from 'react';
import { forceLiveBuildSellSite } from '../actions';

interface Props {
  siteId: string;
  status: string;
}

export function ForceLiveButton({ siteId, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  if (status === 'building' || status === 'failed' || status === 'live') return null;

  function handleConfirm() {
    const fd = new FormData();
    fd.append('id', siteId);
    startTransition(async () => {
      const result = await forceLiveBuildSellSite(fd);
      setOk(result.ok);
      setMessage(result.message ?? (result.ok ? 'Site is now live.' : 'Failed.'));
      if (result.ok) setConfirming(false);
    });
  }

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-sm space-y-2">
      <p className="font-medium text-slate-300">Go live without an invoice</p>
      <p className="text-xs text-slate-500">
        For sites sold or handled outside the in-app invoice flow. No payment is collected or
        recorded — this only flips the site to live (crawlable, customer access provisioned).
      </p>
      {message && (
        <p className={`text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{message}</p>
      )}
      {!confirming ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => { setConfirming(true); setMessage(null); }}
          className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
        >
          Mark live (skip invoice)
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-400">Skip invoicing and go live now?</span>
          <button
            type="button"
            disabled={pending}
            onClick={handleConfirm}
            className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
          >
            {pending ? '…' : 'Confirm'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
