'use client';

import { useTransition, useState } from 'react';
import { applyCalibrationSuggestion, dismissCalibrationSuggestion } from './actions';

/** Apply button — rendered ONLY for scope='global' rows by SuggestionsPanel (server-side gate). */
export function ApplySuggestionButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleApply() {
    startTransition(async () => {
      const result = await applyCalibrationSuggestion(id);
      setMessage(result.message ?? (result.ok ? 'Applied.' : 'Failed.'));
    });
  }

  if (message) {
    return <p className="text-xs text-slate-400">{message}</p>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleApply}
      className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-2.5 py-1 text-xs font-medium text-white"
    >
      {pending ? '…' : 'Apply'}
    </button>
  );
}

/** Dismiss button — used for scope='trade'/'trade_state' rows (no Apply action exists for them). */
export function DismissSuggestionButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);

  function handleDismiss() {
    startTransition(async () => {
      await dismissCalibrationSuggestion(id);
      setDismissed(true);
    });
  }

  if (dismissed) {
    return <p className="text-xs text-slate-500">Dismissed.</p>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleDismiss}
      className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-2.5 py-1 text-xs font-medium text-slate-100"
    >
      {pending ? '…' : 'Dismiss'}
    </button>
  );
}
