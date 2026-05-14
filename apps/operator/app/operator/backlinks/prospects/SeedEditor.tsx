'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { suggestCompetitorSeeds, updateCompetitorSeeds } from '../actions';

interface Props {
  siteId: string;
  seeds: string[];
}

export function SeedEditor({ siteId, seeds: initialSeeds }: Props) {
  const [seeds, setSeeds] = useState<string[]>(initialSeeds);
  const [input, setInput] = useState('');
  const [pending, startTransition] = useTransition();
  const [suggesting, startSuggesting] = useTransition();
  const [suggestions, setSuggestions] = useState<Array<{ domain: string; rationale: string }>>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function suggest() {
    setMsg(null);
    setSuggestions([]);
    startSuggesting(async () => {
      const r = await suggestCompetitorSeeds(siteId);
      if (r.ok && r.suggestions) {
        setSuggestions(r.suggestions.filter((s) => !seeds.includes(s.domain)));
        if (r.suggestions.length === 0) setMsg({ ok: false, text: 'no suggestions' });
      } else {
        setMsg({ ok: false, text: r.message ?? 'suggest failed' });
      }
    });
  }

  function acceptSuggestion(domain: string) {
    setSeeds([...new Set([...seeds, domain])]);
    setSuggestions(suggestions.filter((s) => s.domain !== domain));
  }

  function acceptAllSuggestions() {
    setSeeds([...new Set([...seeds, ...suggestions.map((s) => s.domain)])]);
    setSuggestions([]);
  }

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

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded bg-sky-700/60 hover:bg-sky-700/80 text-sky-100 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save seeds'}
        </button>
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting}
          className="text-xs px-3 py-1.5 rounded bg-violet-700/60 hover:bg-violet-700/80 text-violet-100 disabled:opacity-50"
          title="Ask Claude for 3 seed competitors based on niche + city"
        >
          {suggesting ? 'Thinking…' : 'Suggest with AI'}
        </button>
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
            {msg.text}
          </span>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1.5 rounded border border-violet-900/60 bg-violet-950/30 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-violet-200">AI suggestions</span>
            <button
              type="button"
              onClick={acceptAllSuggestions}
              className="text-xs px-2 py-0.5 rounded bg-violet-700/60 hover:bg-violet-700/80 text-violet-100"
            >
              Accept all
            </button>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.domain} className="flex items-start gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => acceptSuggestion(s.domain)}
                  className="px-1.5 py-0.5 rounded bg-violet-800/60 hover:bg-violet-700/80 text-violet-100 leading-none"
                  aria-label={`Add ${s.domain}`}
                >
                  +
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-slate-200">{s.domain}</div>
                  {s.rationale && <div className="text-slate-400 text-[11px]">{s.rationale}</div>}
                </div>
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-slate-500">
            Click + to add. Suggestions are not saved until you press “Save seeds”.
          </div>
        </div>
      )}
    </div>
  );
}
