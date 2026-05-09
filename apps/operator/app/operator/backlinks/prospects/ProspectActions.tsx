'use client';

import { useState, useTransition } from 'react';
import { rejectBacklink, sendProspect, setProspectEditorEmail } from '../actions';

export function ProspectRowActions({
  id,
  hasEmail,
  needsManualEditor,
}: {
  id: string;
  hasEmail: boolean;
  needsManualEditor: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');

  function approveAndSend() {
    if (!confirm('Send this pitch via the production email pipeline?')) return;
    setMsg(null);
    startTransition(async () => {
      const r = await sendProspect(id);
      setMsg(r.ok ? 'sent' : (r.message ?? 'send failed'));
    });
  }
  function reject() {
    const reason = prompt('Rejection reason (optional)');
    setMsg(null);
    startTransition(async () => {
      const r = await rejectBacklink(id, reason ?? undefined);
      if (!r.ok) setMsg(r.message ?? 'reject failed');
    });
  }
  function saveEmail() {
    setMsg(null);
    startTransition(async () => {
      const r = await setProspectEditorEmail(id, emailInput);
      setMsg(r.ok ? 'editor saved — refresh to see the row update' : (r.message ?? 'save failed'));
    });
  }

  if (needsManualEditor && !hasEmail) {
    return (
      <div className="flex flex-col gap-2 min-w-[260px]">
        <div className="flex items-center gap-1">
          <input
            type="email"
            placeholder="editor@target.com"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="flex-1 text-xs rounded bg-slate-950 border border-slate-700 px-2 py-1 text-slate-200 font-mono"
          />
          <button
            type="button"
            onClick={saveEmail}
            disabled={pending || !emailInput.includes('@')}
            className="text-xs px-2 py-1 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-100 disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <button
          type="button"
          onClick={reject}
          disabled={pending}
          className="text-xs px-2 py-1 rounded bg-red-700/40 hover:bg-red-700/60 text-red-200 disabled:opacity-50 self-start"
        >
          Reject
        </button>
        {msg && (
          <span
            className={`text-xs ${msg.startsWith('editor saved') ? 'text-emerald-300' : 'text-amber-300'}`}
          >
            {msg}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={approveAndSend}
        disabled={pending || !hasEmail}
        className="text-xs px-2 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50"
      >
        Approve &amp; send
      </button>
      <button
        type="button"
        onClick={reject}
        disabled={pending}
        className="text-xs px-2 py-1 rounded bg-red-700/40 hover:bg-red-700/60 text-red-200 disabled:opacity-50"
      >
        Reject
      </button>
      {msg && (
        <span
          className={`text-xs ${msg === 'sent' ? 'text-emerald-300' : 'text-amber-300'}`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
