'use client';

import { useTransition } from 'react';
import type { CallMode } from '@leadlandlord/db';
import { setCallMode } from './actions';

interface Props {
  siteId: string;
  current: CallMode;
}

const OPTIONS: Array<{ value: CallMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'No AI answering (default, safety gate).' },
  { value: 'ai_first', label: 'AI answers first', hint: 'AI answers every inbound call, qualifies, then warm-transfers.' },
  { value: 'fallback', label: 'AI fallback', hint: "Tenant's phone rings first; AI answers on no-answer/busy." },
];

export function CallModeSelector({ siteId, current }: Props) {
  const [pending, startTransition] = useTransition();

  function select(mode: CallMode) {
    if (mode === current || pending) return;
    startTransition(async () => {
      await setCallMode(siteId, mode);
    });
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={pending}
            onClick={() => select(opt.value)}
            aria-pressed={current === opt.value}
            title={opt.hint}
            className={`px-3 py-1.5 text-sm min-h-[36px] transition-colors disabled:opacity-50 ${
              current === opt.value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
            } ${opt.value !== 'off' ? 'border-l border-slate-800' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {pending ? 'Saving…' : OPTIONS.find((o) => o.value === current)?.hint}
      </p>
    </div>
  );
}
