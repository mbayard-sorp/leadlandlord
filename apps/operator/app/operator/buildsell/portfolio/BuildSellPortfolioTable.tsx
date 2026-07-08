'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BUILDSELL_PRESET_NAMES } from '@leadlandlord/sanity-schema/presets';
import { updateOwnerEmail } from '../[id]/lead-forwarding-actions';
import {
  setBuildSellVisibility,
  updateBuildSellPrice,
  updateBuildSellThemePreset,
  type PortfolioActionResult,
} from './actions';
import type { BsPortfolioRow, BuildsellStatus } from './types';

const STATUS_CLS: Record<BuildsellStatus, string> = {
  draft: 'bg-slate-700 text-slate-300',
  building: 'bg-amber-900/60 text-amber-300',
  invoiced: 'bg-blue-900/60 text-blue-300',
  paid: 'bg-purple-900/60 text-purple-300',
  live: 'bg-emerald-900/60 text-emerald-300',
  failed: 'bg-red-900/60 text-red-300',
};

const FILTERS: Array<{ key: 'all' | BuildsellStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'building', label: 'Building' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'paid', label: 'Paid' },
  { key: 'live', label: 'Live' },
  { key: 'failed', label: 'Failed' },
];

function StatusPill({ status }: { status: BuildsellStatus }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLS[status]}`}>
      {status}
    </span>
  );
}

export function BuildSellPortfolioTable({
  rows,
  siteHost,
}: {
  rows: BsPortfolioRow[];
  siteHost: string;
}) {
  const [filter, setFilter] = useState<'all' | BuildsellStatus>('all');
  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? rows.length : rows.filter((r) => r.status === f.key).length;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-xs rounded border px-2 py-1 ${
                active
                  ? 'border-sky-500 bg-sky-900/30 text-sky-200'
                  : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <th className="px-2 py-2 font-medium">Business</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium hidden md:table-cell">Domain</th>
              <th className="px-2 py-2 font-medium">Leads</th>
              <th className="px-2 py-2 font-medium hidden lg:table-cell">Portal</th>
              <th className="px-2 py-2 font-medium">Links</th>
              <th className="px-2 py-2 font-medium">Config</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <Row key={row.id} row={row} siteHost={siteHost} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, siteHost }: { row: BsPortfolioRow; siteHost: string }) {
  return (
    <>
      <tr className="border-b border-slate-800/50 hover:bg-slate-800/20 align-top">
        <td className="px-2 py-2">
          <div className="font-medium text-slate-200 flex items-center gap-1.5">
            {row.businessName}
            {row.lastBuildError && (
              <span
                className="inline-block h-2 w-2 rounded-full bg-red-500"
                title={row.lastBuildError}
              />
            )}
          </div>
          <div className="text-xs text-slate-500">
            {row.city}, {row.state} · {row.trade}
          </div>
        </td>
        <td className="px-2 py-2">
          <StatusPill status={row.status} />
        </td>
        <td className="px-2 py-2 hidden md:table-cell">
          {row.customDomain ? (
            <div className="text-xs">
              <div className="text-slate-300">{row.customDomain}</div>
              <DomainPill status={row.domainStatus} />
            </div>
          ) : (
            <span className="text-xs text-slate-600">—</span>
          )}
        </td>
        <td className="px-2 py-2">
          <span className="text-slate-300">{row.leadsCount}</span>
          {row.leadFailureCount > 0 && (
            <span className="ml-1 text-xs text-red-400" title="failed to deliver">
              ({row.leadFailureCount}✗)
            </span>
          )}
        </td>
        <td className="px-2 py-2 hidden lg:table-cell text-slate-400">
          {row.activeAccessCount > 0 ? row.activeAccessCount : '—'}
        </td>
        <td className="px-2 py-2">
          <div className="flex flex-col gap-1">
            <a
              href={`https://${siteHost}/preview/${row.slug ?? row.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              Preview
            </a>
            {row.status === 'live' && row.slug && (
              <a
                href={`https://${siteHost}/buildsell/${row.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-emerald-400 hover:text-emerald-300 underline"
              >
                Live
              </a>
            )}
            <a
              href={`/operator/buildsell/${row.id}`}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Detail →
            </a>
          </div>
        </td>
        <td className="px-2 py-2">
          <QuickEdit row={row} />
        </td>
      </tr>
    </>
  );
}

function DomainPill({ status }: { status: BsPortfolioRow['domainStatus'] }) {
  if (status === 'verified') {
    return <span className="text-xs text-emerald-400">verified</span>;
  }
  if (status === 'pending') {
    return <span className="text-xs text-amber-400">pending</span>;
  }
  return <span className="text-xs text-slate-600">none</span>;
}

function QuickEdit({ row }: { row: BsPortfolioRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Derive live visibility from Sanity when available; fall back to status.
  const visible = row.draftMode == null ? row.status === 'live' : !row.draftMode;
  const locked = row.themeLocked === true;

  function run(action: () => Promise<PortfolioActionResult>) {
    setMsg(null);
    startTransition(async () => {
      const r = await action();
      setMsg({ ok: r.ok, text: r.message ?? (r.ok ? 'Saved.' : 'Failed.') });
      if (r.ok) router.refresh();
    });
  }

  function submitPrice(fd: FormData) {
    fd.set('site_id', row.id);
    run(() => updateBuildSellPrice(fd));
  }

  function submitOwner(fd: FormData) {
    fd.set('site_id', row.id);
    run(() => updateOwnerEmail(fd));
  }

  function toggleVisibility(next: boolean) {
    if (!next && row.status === 'live') {
      const ok = window.confirm(
        'Hide this LIVE site from search? It will be de-indexed until you re-enable it.',
      );
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('site_id', row.id);
    fd.set('visible', String(next));
    run(() => setBuildSellVisibility(fd));
  }

  function changePreset(preset: string) {
    if (!preset || preset === (row.sanityPreset ?? row.themePreset)) return;
    const fd = new FormData();
    fd.set('site_id', row.id);
    fd.set('preset', preset);
    run(() => updateBuildSellThemePreset(fd));
  }

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-slate-400 hover:text-slate-200 select-none">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span> Edit
      </summary>
      <div className="mt-2 w-64 space-y-2 rounded border border-slate-700 bg-slate-900/80 p-2">
        {/* Owner email */}
        <form action={submitOwner} className="space-y-1">
          <label className="block text-xs text-slate-500">Owner email (lead forwarding)</label>
          <div className="flex gap-1">
            <input
              type="email"
              name="owner_email"
              defaultValue={row.ownerEmail ?? ''}
              placeholder="owner@example.com"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>

        {/* Price */}
        <form action={submitPrice} className="space-y-1">
          <label className="block text-xs text-slate-500">Price (USD)</label>
          <div className="flex gap-1">
            <input
              type="number"
              name="price_usd"
              min="0"
              step="0.01"
              defaultValue={row.priceUsd ?? ''}
              placeholder="e.g. 1200"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>

        {/* SEO visibility */}
        <div className="space-y-1">
          <label className="block text-xs text-slate-500">Search visibility</label>
          <button
            type="button"
            disabled={pending || row.status === 'draft'}
            onClick={() => toggleVisibility(!visible)}
            title={row.status === 'draft' ? 'Drafts are hidden by design' : undefined}
            className={`w-full rounded border px-2 py-1 text-xs disabled:opacity-50 ${
              visible
                ? 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300 hover:bg-emerald-900/40'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {visible ? 'Visible — click to hide' : 'Hidden — click to show'}
          </button>
        </div>

        {/* Theme preset */}
        <div className="space-y-1">
          <label className="block text-xs text-slate-500">
            Theme preset {locked && <span className="text-slate-600">(locked)</span>}
          </label>
          <select
            disabled={pending || locked}
            defaultValue={row.sanityPreset ?? row.themePreset ?? ''}
            onChange={(e) => changePreset(e.target.value)}
            title={locked ? 'Theme is locked — unlock via the detail page' : undefined}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
          >
            <option value="" disabled>
              Select preset…
            </option>
            {BUILDSELL_PRESET_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {msg && (
          <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
        )}
      </div>
    </details>
  );
}
