'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { manuallyAcceptBacklink, markDeclined, markLive as markLiveAction } from '@/lib/links/draft-actions';

interface Props {
  id: string;
  status: string;
}

export function DetailActions({ id, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [showLiveForm, setShowLiveForm] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState('');

  function accept() {
    setMsg(null);
    startTransition(async () => {
      const r = await manuallyAcceptBacklink(id);
      if (!r.ok) setMsg(r.message ?? 'failed');
      else router.refresh();
    });
  }

  function decline() {
    setMsg(null);
    startTransition(async () => {
      const r = await markDeclined(id);
      if (!r.ok) setMsg(r.message ?? 'failed');
      else {
        setConfirmDecline(false);
        router.refresh();
      }
    });
  }

  function markAsLive() {
    setMsg(null);
    startTransition(async () => {
      const r = await markLiveAction(id, publishedUrl);
      if (!r.ok) setMsg(r.message ?? 'failed');
      else {
        setShowLiveForm(false);
        router.refresh();
      }
    });
  }

  const isDead =
    status === 'declined' ||
    status === 'silent' ||
    status === 'rejected' ||
    status === 'lost' ||
    status === 'dormant';
  const isLive = status === 'live' || status === 'verified' || status === 'published';

  if (isDead || isLive) return null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 uppercase tracking-wide font-medium">
        Manual overrides
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Accept (emits event for MollyCopywriter) */}
        {(status === 'awaiting_reply' ||
          status === 'reply_received' ||
          status === 'escalated' ||
          status === 'manual_review') && (
          <button
            type="button"
            onClick={accept}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
          >
            {pending ? 'Accepting…' : 'Mark accepted'}
          </button>
        )}

        {/* Decline */}
        {!confirmDecline ? (
          <button
            type="button"
            onClick={() => setConfirmDecline(true)}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded border border-red-800/60 text-red-300 hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
          >
            Mark declined
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-300">Confirm decline?</span>
            <button
              type="button"
              onClick={decline}
              disabled={pending}
              className="text-xs px-2.5 py-1 rounded bg-red-700/50 text-red-100 disabled:opacity-50"
            >
              {pending ? '…' : 'Yes, decline'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDecline(false)}
              className="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Mark live */}
        {(status === 'draft_approved' || status === 'delivered') && !showLiveForm && (
          <button
            type="button"
            onClick={() => setShowLiveForm(true)}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
          >
            Mark live
          </button>
        )}
      </div>

      {showLiveForm && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="url"
            value={publishedUrl}
            onChange={(e) => setPublishedUrl(e.target.value)}
            placeholder="https://example.com/your-guest-post"
            className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500 w-72"
          />
          <button
            type="button"
            onClick={markAsLive}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Confirm live'}
          </button>
          <button
            type="button"
            onClick={() => setShowLiveForm(false)}
            className="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-300"
          >
            Cancel
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-amber-300">{msg}</p>}
    </div>
  );
}
