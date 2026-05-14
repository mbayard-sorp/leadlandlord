'use client';

import { useEffect, useRef, useState } from 'react';

interface SiteOption {
  id: string;
  label: string;
  hasCompetitorSeeds: boolean;
}

interface Props {
  onSelect: (siteId: string) => void;
  selectedId?: string;
}

export function SiteCombobox({ onSelect, selectedId }: Props) {
  const [options, setOptions] = useState<SiteOption[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/operator/prospects/sites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: SiteOption[]) => setOptions(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const found = options.find((o) => o.id === selectedId);
    if (found) setQuery(found.label);
  }, [selectedId, options]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  function handleSelect(opt: SiteOption) {
    setQuery(opt.label);
    setOpen(false);
    onSelect(opt.id);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder="Search sites…"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded border border-slate-700 bg-slate-900 shadow-lg text-sm">
          {filtered.slice(0, 100).map((o) => (
            <li
              key={o.id}
              onMouseDown={() => handleSelect(o)}
              className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-slate-800 text-slate-200"
            >
              <span>{o.label}</span>
              {o.hasCompetitorSeeds && (
                <span className="text-xs text-emerald-400 ml-2">seeds</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
