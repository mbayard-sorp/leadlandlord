'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { approveDraft, rejectDraft, regenerateDraft } from '@/lib/links/draft-actions';
import { ReasonChips } from '@/components/ReasonChips';

export function DraftReviewActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);

  function approve() {
    setMsg(null);
    startTransition(async () => {
      const r = await approveDraft(id);
      if (!r.ok) setMsg(r.message ?? 'approve failed');
      else router.refresh();
    });
  }

  function reject(reason: string) {
    setMsg(null);
    startTransition(async () => {
      const r = await rejectDraft(id, reason);
      if (!r.ok) setMsg(r.message ?? 'reject failed');
      else {
        setShowReject(false);
        router.refresh();
      }
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
      <div className="space-y-3">
        {/* Sticky mobile bottom bar */}
        <div className="sticky bottom-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 -mx-4 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="text-sm px-4 py-2 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50 font-medium"
          >
            Approve draft
          </button>
          <button
            type="button"
            onClick={() => setShowReject((v) => !v)}
            disabled={pending}
            className="text-sm px-4 py-2 rounded border border-red-800/60 text-red-300 hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
          >
            Reject
          </button>
          {msg && <span className="text-xs text-amber-300">{msg}</span>}
        </div>

        {showReject && (
          <div className="mt-2">
            <ReasonChips
              onConfirm={reject}
              onCancel={() => setShowReject(false)}
              pending={pending}
              label="Why are you rejecting this draft?"
            />
          </div>
        )}
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
