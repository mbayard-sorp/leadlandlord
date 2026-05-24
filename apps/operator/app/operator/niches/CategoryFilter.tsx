'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CATEGORY_LABELS } from './NicheRow';

export function CategoryFilter({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = searchParams.get('category') ?? '';

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('category', value);
    else params.delete('category');
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `?${qs}` : '?', { scroll: false }));
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="uppercase tracking-wide">Category</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="rounded bg-slate-950 border border-slate-700 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-50"
      >
        <option value="">All categories ({total})</option>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label} ({counts[value] ?? 0})
          </option>
        ))}
        {counts.__uncategorized__ ? (
          <option value="__uncategorized__">Uncategorized ({counts.__uncategorized__})</option>
        ) : null}
      </select>
    </label>
  );
}
