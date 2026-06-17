'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Timestamp } from '../../../components/Timestamp';
import {
  postOrchestratorMessage,
  resolveQuestion,
  type ThreadSummary,
  type ThreadMessage,
} from './actions';

function roleLabel(m: ThreadMessage): string {
  if (m.role === 'human') return 'You';
  if (m.role === 'system') return 'System';
  return 'Orchestrator';
}

function bubbleClass(m: ThreadMessage): string {
  if (m.role === 'human') return 'bg-emerald-900/40 border-emerald-800';
  if (m.role === 'system') return 'bg-amber-900/30 border-amber-800';
  if (m.kind === 'action') return 'bg-slate-900/40 border-slate-800 text-slate-400';
  return 'bg-slate-800/50 border-slate-700';
}

export function OrchestratorChat({
  threads,
  active,
  enabled = true,
}: {
  threads: ThreadSummary[];
  active: { thread: ThreadSummary; messages: ThreadMessage[] } | null;
  enabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const activeId = active?.thread.id ?? null;
  const openQuestion = active?.messages.find((m) => m.requiresHumanResponse && !m.resolved) ?? null;

  function send() {
    const text = draft.trim();
    if (!text || pending || !enabled) return;
    setErr(null);
    setDraft('');
    startTransition(async () => {
      const r = await postOrchestratorMessage(activeId, text);
      if (!r.ok) setErr(r.message ?? 'failed');
      else if (r.threadId && r.threadId !== activeId)
        router.push(`/operator/orchestrator?thread=${r.threadId}`);
      else router.refresh();
    });
  }

  function answerQuestion() {
    if (!openQuestion) return;
    const text = answer.trim();
    if (!text || pending || !enabled) return;
    setErr(null);
    setAnswer('');
    startTransition(async () => {
      const r = await resolveQuestion(openQuestion.id, text);
      if (!r.ok) setErr(r.message ?? 'failed');
      else router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
      {/* Thread list */}
      <aside className="flex flex-col gap-2">
        <Link
          href="/operator/orchestrator"
          className="inline-flex items-center justify-center min-h-[40px] rounded bg-emerald-700 hover:bg-emerald-600 px-3 text-sm font-medium text-white"
        >
          + New chat
        </Link>
        <div className="flex flex-col gap-1 overflow-y-auto max-h-[60vh]">
          {threads.length === 0 && (
            <p className="text-xs text-slate-500 px-2 py-3">No conversations yet.</p>
          )}
          {threads.map((t) => (
            <Link
              key={t.id}
              href={`/operator/orchestrator?thread=${t.id}`}
              className={`rounded border px-3 py-2 text-xs ${
                t.id === activeId
                  ? 'border-emerald-700 bg-slate-800/70'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {t.openQuestion && (
                  <span
                    title="Awaiting your answer"
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-400"
                  />
                )}
                <span className="truncate text-slate-200">{t.title}</span>
              </span>
              <span className="block text-[10px] text-slate-500 mt-0.5">
                {t.origin === 'orchestrator_question' ? 'question' : 'chat'} ·{' '}
                <Timestamp value={t.lastMessageAt} />
              </span>
            </Link>
          ))}
        </div>
      </aside>

      {/* Conversation */}
      <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/30 p-4 min-h-[60vh]">
        {!active && (
          <p className="text-sm text-slate-400">
            Ask the orchestrator about the fleet — “what’s the fleet status?”, “why is competitor-analyzer
            failing?”, “disable network-linker”. It reads live data and can flip enable/cap/cadence
            settings (never niche approval, site creation, or go-live — those stay yours).
          </p>
        )}

        {active && (
          <>
            <h2 className="text-sm font-semibold text-slate-200">{active.thread.title}</h2>
            <div className="flex flex-col gap-2 overflow-y-auto flex-1">
              {active.messages.map((m) => (
                <div key={m.id} className={`rounded border px-3 py-2 text-sm ${bubbleClass(m)}`}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                    {roleLabel(m)}
                    {m.kind === 'action' && ' · action'}
                    {m.kind === 'question' && ' · question'}
                    {m.requiresHumanResponse && !m.resolved && ' · awaiting answer'}
                  </div>
                  <div className="whitespace-pre-wrap text-slate-100">{m.body}</div>
                </div>
              ))}
            </div>

            {openQuestion && (
              <div className="rounded border border-amber-800 bg-amber-900/20 p-3">
                <p className="text-xs text-amber-200 mb-2">
                  The orchestrator is waiting on your answer.
                </p>
                <div className="flex gap-2">
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') answerQuestion();
                    }}
                    placeholder="Type your answer…"
                    className="flex-1 rounded bg-slate-950 border border-slate-700 px-3 min-h-[44px] text-sm text-slate-100"
                  />
                  <button
                    onClick={answerQuestion}
                    disabled={pending || !enabled}
                    className="rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-4 text-sm font-medium text-white"
                  >
                    {pending ? 'Sending…' : 'Answer'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Composer */}
        <div className="flex gap-2 pt-2 border-t border-slate-800">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
            disabled={!enabled}
            placeholder={
              !enabled
                ? 'Orchestrator is off — turn it on above to chat'
                : active
                  ? 'Message the orchestrator…'
                  : 'Start a new conversation…'
            }
            className="flex-1 rounded bg-slate-950 border border-slate-700 px-3 min-h-[44px] text-sm text-slate-100 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={pending || !enabled}
            className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-4 text-sm font-medium text-white"
          >
            {pending ? 'Thinking…' : 'Send'}
          </button>
        </div>
        {err && <p className="text-xs text-red-300">{err}</p>}
      </section>
    </div>
  );
}
