'use client';

import { useState, useTransition } from 'react';
import { approveApproval, rejectApproval, updateMollyOutreachBody } from './actions';

interface MollyPayload {
  pitchType?: string;
  siteId?: string | null;
  backlinkId?: string | null;
  toAddress?: string;
  fromAddress?: string;
  subject?: string;
  body?: string;
  purpose?: string;
  inReplyToMessageId?: string | null;
  nudgeStep?: number | null;
  anchorType?: string | null;
  targetUrl?: string | null;
}

// Best-effort domain pull from an email address (display only).
function domainOf(email: string | undefined): string {
  if (!email) return '?';
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
}

export function MollyOutreachApproval({ id, payload }: { id: string; payload: unknown }) {
  const p = (payload && typeof payload === 'object' ? payload : {}) as MollyPayload;
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [reason, setReason] = useState('');
  const [subject, setSubject] = useState(p.subject ?? '');
  const [body, setBody] = useState(p.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  function onApprove() {
    setError(null);
    const fd = new FormData();
    fd.append('id', id);
    fd.append('operator_email', 'operator');
    startTransition(async () => {
      const res = await approveApproval(fd);
      if (!res?.ok) setError(res?.message ?? 'Approve failed — try again.');
    });
  }

  function onRejectConfirm() {
    setError(null);
    const fd = new FormData();
    fd.append('id', id);
    fd.append('operator_email', 'operator');
    fd.append('rejection_reason', reason);
    startTransition(async () => {
      const res = await rejectApproval(fd);
      if (!res?.ok) setError(res?.message ?? 'Reject failed — try again.');
    });
  }

  function onSaveEdit() {
    setError(null);
    setSavedNote(null);
    const fd = new FormData();
    fd.append('id', id);
    fd.append('subject', subject);
    fd.append('body', body);
    startTransition(async () => {
      const res = await updateMollyOutreachBody(fd);
      if (!res?.ok) {
        setError(res?.message ?? 'Save failed — try again.');
      } else {
        setSavedNote('Saved. Approve to send the edited version.');
        setShowEdit(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 min-w-[280px] max-w-xl">
      <div className="text-slate-300 space-y-0.5">
        <div className="text-xs">
          <span className="font-mono bg-slate-800 px-1.5 py-0.5 rounded">{p.pitchType ?? '?'}</span>
          {typeof p.nudgeStep === 'number' && (
            <span className="ml-1 text-slate-500">step {p.nudgeStep}</span>
          )}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-500">domain</span> {domainOf(p.toAddress)}
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-500">to</span> {p.toAddress ?? '?'}
        </div>
        {p.fromAddress && (
          <div className="text-xs text-slate-500">from {p.fromAddress}</div>
        )}
        {p.targetUrl && (
          <div className="text-xs text-slate-500 break-all">
            target {p.targetUrl}
            {p.anchorType ? ` (${p.anchorType})` : ''}
          </div>
        )}
      </div>

      {showEdit ? (
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="Body"
            className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500 font-mono"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={onSaveEdit}
              className="text-xs bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white px-2 py-1 rounded"
            >
              {pending ? '...' : 'Save edit'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setShowEdit(false);
                setSubject(p.subject ?? '');
                setBody(p.body ?? '');
              }}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="text-xs text-slate-400">
            <span className="text-slate-500">subject</span> {subject || '(none)'}
          </div>
          <pre className="text-xs text-slate-300 bg-slate-900/60 border border-slate-800 rounded p-2 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {body || '(empty body)'}
          </pre>
        </>
      )}

      {showReject ? (
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={onRejectConfirm}
              className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
            >
              {pending ? '...' : 'Confirm reject'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowReject(false)}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || showEdit}
            onClick={onApprove}
            className="text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-2 py-1 rounded"
          >
            {pending ? '...' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowEdit((v) => !v)}
            className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-2 py-1 rounded"
          >
            Edit body
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowReject(true)}
            className="text-xs bg-rose-800 hover:bg-rose-700 disabled:opacity-50 text-white px-2 py-1 rounded"
          >
            Reject
          </button>
        </div>
      )}

      {savedNote && <p className="text-xs text-emerald-400">{savedNote}</p>}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
