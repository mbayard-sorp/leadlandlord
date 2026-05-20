'use client';

import { useState } from 'react';

interface Props {
  title: string;
  count: number;
  defaultOpen?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, count, defaultOpen = false, muted, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wide mb-2 w-full text-left ${muted ? 'text-slate-500' : 'text-slate-300'}`}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <span className={`text-xs font-normal normal-case tracking-normal ${muted ? 'text-slate-600' : 'text-slate-400'}`}>
          ({count})
        </span>
      </button>
      {open && children}
    </section>
  );
}
