'use client';

import { useState, useTransition } from 'react';
import { insertManualCall } from './actions';

interface Props {
  siteId: string;
}

/**
 * Quick form for inserting a synthetic call row — handy for testing the call
 * log UI before real Twilio webhooks land.
 */
export function ManualCallForm({ siteId }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('site_id', siteId);
    startTransition(async () => {
      setResult(null);
      const r = await insertManualCall(fd);
      setResult(r);
      if (r.ok) e.currentTarget?.reset();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 space-y-3"
    >
      <p className="text-xs uppercase tracking-wide text-slate-500">Manual call entry (test)</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          name="caller_number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+15125550100"
          required
          className="cell"
        />
        <input
          name="duration_s"
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="seconds"
          className="cell"
        />
        <select name="classification" defaultValue="unclassified" className="cell">
          <option value="unclassified">unclassified</option>
          <option value="won">won</option>
          <option value="quoted">quoted</option>
          <option value="lost">lost</option>
          <option value="spam">spam</option>
          <option value="no_voicemail">no_voicemail</option>
        </select>
      </div>
      <textarea
        name="transcript"
        rows={2}
        placeholder="Optional transcript…"
        enterKeyHint="send"
        className="cell w-full"
      />
      {result && (
        <p className={`text-xs ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {result.ok ? 'Inserted.' : (result.message ?? 'Failed.')}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center min-h-[44px] px-4 rounded bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Inserting…' : 'Insert call'}
        </button>
      </div>
    </form>
  );
}
