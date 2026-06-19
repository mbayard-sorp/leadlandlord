'use client';

import { useState, useTransition } from 'react';
import { reviseBuildSellCopy } from './actions';

interface Props {
  siteId: string;
  /** Last clarification applied to this site, surfaced for context. */
  lastPrompt?: { prompt: string; revisedAt: string } | null;
}

const MAX = 500;

/**
 * Copy-revision panel. The operator describes what the business actually is/does
 * and the spec-site-builder regenerates the copy with that clarification while
 * keeping the existing design (preserve_theme). Use when the generated copy
 * misreads the business.
 *
 * Hidden on paid/live sites (gated by the page). The server action enforces a
 * durable per-site daily cap (BUILDSELL_REVISE_CAP_PER_DAY, default 5) and a
 * 500-char limit. The clarification is fed to the model as a subordinate hint —
 * it cannot override the ToS hard rules.
 */
export function BuildSellRevisePanel({ siteId, lastPrompt }: Props) {
  const [prompt, setPrompt] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = prompt.trim();
  const tooLong = trimmed.length > MAX;
  const empty = trimmed.length === 0;

  function handleRevise() {
    setMsg(null);
    startTransition(async () => {
      const r = await reviseBuildSellCopy(siteId, prompt);
      if (r.ok) {
        setMsg({ kind: 'ok', text: 'Revision queued — copy regenerates in a few minutes (design unchanged). Refresh the preview shortly.' });
        setPrompt('');
      } else {
        setMsg({ kind: 'err', text: r.message ?? 'revision failed' });
      }
    });
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Revise copy
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Clarify what the business actually is/does and regenerate the copy. The design
          (colors, layout, fonts) is kept. Rate-limited per site per day
          (BUILDSELL_REVISE_CAP_PER_DAY, default 5).
        </p>
      </header>

      {lastPrompt?.prompt && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
          <span className="text-slate-500">Last clarification</span>
          {lastPrompt.revisedAt && (
            <span className="text-slate-600"> · {new Date(lastPrompt.revisedAt).toLocaleString()}</span>
          )}
          <p className="text-slate-300 mt-1 whitespace-pre-wrap">{lastPrompt.prompt}</p>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-sky-700"
          rows={4}
          maxLength={MAX + 50}
          placeholder="e.g. This business SELLS automotive paint and refinishing products to retail and trade customers. It is NOT a body shop and does not paint cars."
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setMsg(null); }}
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleRevise}
            disabled={pending || empty || tooLong}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-xs hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? 'Queuing…' : 'Revise copy'}
          </button>
          <span className={`text-xs ${tooLong ? 'text-red-300' : 'text-slate-600'}`}>
            {trimmed.length}/{MAX}
          </span>
        </div>

        {msg && (
          <p className={`text-xs ${msg.kind === 'err' ? 'text-red-300' : 'text-emerald-300'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
