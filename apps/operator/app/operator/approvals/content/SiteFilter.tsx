'use client';

import { useRouter } from 'next/navigation';

export interface SiteOption {
  id: string;
  label: string;
}

interface SiteFilterProps {
  sites: SiteOption[];
  current: string | undefined;
}

export function SiteFilter({ sites, current }: SiteFilterProps) {
  const router = useRouter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const qs = value ? `?site_id=${encodeURIComponent(value)}` : '';
    router.push(`/operator/approvals/content${qs}`);
  }

  return (
    <select
      value={current ?? ''}
      onChange={handleChange}
      className="rounded border border-slate-700 bg-slate-900/40 text-slate-200 text-xs px-3 py-1.5"
    >
      <option value="">All sites</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
