'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveDraft, rejectDraft, regenerateDraft } from '../../actions';

export function DraftReviewActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function approve() {
    setMsg(null);
    startTransition(async () => {
      const r = await approveDraft(id);
      if (!r.ok) setMsg(r.message ?? 'approve failed');
      else router.refresh();
    });
  }

  function reject() {
    const reason = prompt('Why are you rejecting this draft? (sent back to the agent for next regenerate)');
    if (!reason || reason.trim().length === 0) return;
    setMsg(null);
    startTransition(async () => {
      const r = await rejectDraft(id, reason);
      if (!r.ok) setMsg(r.message ?? 'reject failed');
      else router.refresh();
    });
  }

  function regenerate() {
    setMsg(null);
    startTransition(async () => {
      const r = await regenerateDraft(id);
      if (!r.ok) setMsg(r.message ?? 'regenerate failed');
      else router.refresh();
    });
  }

  if (status === 'draft_pending_review') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="text-sm px-3 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
        >
          Approve draft
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={pending}
          className="text-sm px-3 py-1.5 rounded bg-red-700/40 hover:bg-red-700/60 text-red-200 disabled:opacity-50"
        >
          Reject
        </button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>
    );
  }

  if (status === 'accepted') {
    return (
      <div className="flex items-center gap-2 justify-center">
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="text-sm px-3 py-1.5 rounded bg-sky-700/40 hover:bg-sky-700/60 text-sky-200 disabled:opacity-50"
        >
          {pending ? 'Drafting…' : 'Generate draft now'}
        </button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>
    );
  }

  return null;
}
