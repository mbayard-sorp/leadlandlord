'use client';

import { useState } from 'react';

const PRESET_REASONS = [
  'Low quality',
  'Irrelevant niche',
  'Link farm',
  'No contact',
  'Too corporate',
] as const;

interface Props {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  pending?: boolean;
  label?: string;
}

export function ReasonChips({ onConfirm, onCancel, pending, label = 'Why?' }: Props) {
  const [selected, setSelected] = useState<string>('');
  const [custom, setCustom] = useState('');

  const reason = selected || custom.trim();

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setSelected((prev) => (prev === r ? '' : r));
              setCustom('');
            }}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              selected === r
                ? 'border-amber-600 bg-amber-900/40 text-amber-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={custom}
        onChange={(e) => {
          setCustom(e.target.value);
          setSelected('');
        }}
        placeholder="Or type a custom reason…"
        className="w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => reason && onConfirm(reason)}
          disabled={!reason || pending}
          className="text-xs px-3 py-1.5 rounded bg-red-700/50 hover:bg-red-700/70 text-red-100 disabled:opacity-40"
        >
          {pending ? 'Rejecting…' : 'Confirm reject'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
