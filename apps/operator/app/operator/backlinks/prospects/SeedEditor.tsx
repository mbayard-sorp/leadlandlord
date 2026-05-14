'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateCompetitorSeeds } from '../actions';

interface Props {
  siteId: string;
  seeds: string[];
}

export function SeedEditor({ siteId, seeds: initialSeeds }: Props) {
  const [seeds, setSeeds] = useState<string[]>(initialSeeds);
  const [input, setInput] = useState('');
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function addSeed() {
    const val = input.trim();
    if (!val) return;
    const next = [...new Set([...seeds, val])];
    setSeeds(next);
    setInput('');
    inputRef.current?.focus();
  }

  function removeSeed(s: string) {
    setSeeds(seeds.filter((x) => x !== s));
  }

  function save() {
    setMsg(null);
    const cleaned = [...new Set(seeds.map((s) => s.trim()).filter(Boolean))];
    startTransition(async () => {
      const r = await updateCompetitorSeeds(siteId, cleaned);
      setMsg({ ok: r.ok, text: r.ok ? 'Saved' : (r.message ?? 'save failed') });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {seeds.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-200"
          >
            {s}
            <button
              type="button"
              onClick={() => removeSeed(s)}
              className="text-slate-400 hover:text-slate-100 leading-none"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        {seeds.length === 0 && (
          <span className="text-xs text-slate-500">No seeds — add competitor domains below</span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSeed(); } }}
          placeholder="competitor-domain.com"
          className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200 font-mono placeholder-slate-500"
        />
        <button
          type="button"
          onClick={addSeed}
          disabled={!input.trim()}
          className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700/80 text-sky-100 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save seeds'}
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
