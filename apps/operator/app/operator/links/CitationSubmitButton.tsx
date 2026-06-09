'use client';

import { useTransition } from 'react';
import { markCitationSubmitted } from '@/lib/links/draft-actions';

export function CitationSubmitButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function handle() {
    startTransition(async () => {
      await markCitationSubmitted(id);
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className="text-xs px-2.5 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50 whitespace-nowrap"
    >
      {pending ? '…' : 'Mark submitted'}
    </button>
  );
}
