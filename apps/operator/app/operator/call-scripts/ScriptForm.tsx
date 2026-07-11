'use client';

import { useState, useTransition } from 'react';
import type { CallQualificationScript } from '@leadlandlord/db';
import { saveCallScript, deleteCallScript } from './actions';

interface Props {
  /** Existing row to edit, or null to render a blank "create new" form. */
  script: CallQualificationScript | null;
}

export function ScriptForm({ script }: Props) {
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isDefault = script != null && script.niche === null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    startTransition(async () => {
      const r = await saveCallScript(fd);
      setMsg({ ok: r.ok, text: r.ok ? 'Saved.' : (r.message ?? 'Save failed.') });
    });
  }

  function onDelete() {
    if (!script) return;
    if (!window.confirm(`Delete the "${script.niche}" script?`)) return;
    setMsg(null);
    startDelete(async () => {
      const r = await deleteCallScript(script.id);
      if (!r.ok) setMsg({ ok: false, text: r.message ?? 'Delete failed.' });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4"
    >
      {script?.id && <input type="hidden" name="id" value={script.id} />}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
            Niche
          </label>
          {isDefault ? (
            <>
              <input type="hidden" name="niche" value="" />
              <p className="text-sm font-medium text-slate-200">Default (all niches)</p>
            </>
          ) : (
            <input
              name="niche"
              defaultValue={script?.niche ?? ''}
              placeholder="e.g. plumbing, roofing — leave blank for a new default"
              className="input"
            />
          )}
        </div>
        {script && !isDefault && (
          <button
            type="button"
            disabled={deleting}
            onClick={onDelete}
            className="mt-5 rounded bg-red-900 hover:bg-red-800 disabled:opacity-50 px-2 py-1 text-xs font-medium text-red-100"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          Questions (one per line, asked in order)
        </label>
        <textarea
          name="questions"
          defaultValue={(script?.questions ?? []).join('\n')}
          rows={6}
          placeholder={'What kind of job do you need done?\nHow soon do you need this handled?\nWhat’s the service address?'}
          className="input font-mono text-xs"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          System prompt override (optional)
        </label>
        <textarea
          name="system_prompt_override"
          defaultValue={script?.systemPromptOverride ?? ''}
          rows={4}
          placeholder="Leave blank to use the shared ElevenLabs agent's default system prompt."
          className="input font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium text-white"
        >
          {pending ? 'Saving…' : script ? 'Save' : 'Create script'}
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}
