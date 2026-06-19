'use client';

import { useTransition, useState } from 'react';
import { runBuildSellSearch, buildDraft, type BuildSellLeadResult } from './actions';

export function SearchPanel() {
  const [searching, startSearch] = useTransition();
  const [leads, setLeads] = useState<BuildSellLeadResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSearchError(null);
    startSearch(async () => {
      const result = await runBuildSellSearch(fd);
      if (result.ok && result.leads) {
        setLeads(result.leads);
      } else {
        setSearchError(result.message ?? 'Search failed.');
        setLeads(null);
      }
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
        Find leads
      </h2>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
        <Field label="Trade">
          <input
            name="trade"
            type="text"
            placeholder="e.g. pool service"
            required
            className="input"
          />
        </Field>
        <Field label="City">
          <input
            name="city"
            type="text"
            placeholder="e.g. Scottsdale"
            required
            className="input"
          />
        </Field>
        <Field label="State">
          <input
            name="state"
            type="text"
            placeholder="AZ"
            maxLength={2}
            required
            className="input w-20 uppercase"
          />
        </Field>
        <Field label="Count">
          <input
            name="count"
            type="number"
            defaultValue={20}
            min={1}
            max={50}
            className="input w-24"
          />
        </Field>
        <button
          type="submit"
          disabled={searching}
          className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-4 py-1.5 text-sm font-medium text-white"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searchError && (
        <p className="text-sm text-red-400">{searchError}</p>
      )}

      {leads !== null && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            {leads.length === 0
              ? 'No qualifying leads found (no-website + rating + review filters applied).'
              : `${leads.length} lead${leads.length === 1 ? '' : 's'} found — no website, strong reviews.`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {leads.map((lead) => (
              <LeadCard key={lead.placeId} lead={lead} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      {children}
    </label>
  );
}

// ─── Lead card ───────────────────────────────────────────────────────────────

function LeadCard({ lead }: { lead: BuildSellLeadResult }) {
  const [open, setOpen] = useState(false);
  const [building, startBuild] = useTransition();
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [buildOk, setBuildOk] = useState<boolean | null>(null);

  async function handleBuild(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startBuild(async () => {
      const result = await buildDraft(fd);
      setBuildOk(result.ok);
      if (result.ok) {
        setBuildMessage(`Draft created (${result.buildsellSiteId?.slice(0, 8)}…). Reload the sites list.`);
        setOpen(false);
      } else {
        setBuildMessage(result.message ?? 'Failed.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-2">
      <div className="font-medium text-slate-200 text-sm">{lead.displayName ?? '(unnamed)'}</div>

      {lead.rating != null && (
        <div className="text-xs text-slate-400">
          {lead.rating.toFixed(1)} stars ({lead.userRatingCount ?? 0} reviews)
        </div>
      )}
      {lead.formattedAddress && (
        <div className="text-xs text-slate-500 truncate">{lead.formattedAddress}</div>
      )}
      {lead.nationalPhone && (
        <div className="text-xs text-slate-400">{lead.nationalPhone}</div>
      )}
      {lead.primaryType && (
        <div className="text-xs text-slate-600 italic">{lead.primaryType.replace(/_/g, ' ')}</div>
      )}

      {buildMessage && (
        <p className={`text-xs ${buildOk ? 'text-emerald-400' : 'text-red-400'}`}>
          {buildMessage}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setBuildMessage(null); }}
          className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-xs font-medium text-slate-100"
        >
          Build draft
        </button>
      ) : (
        <form onSubmit={handleBuild} className="space-y-2 pt-1 border-t border-slate-800">
          {/* Hidden fields from the card */}
          <input type="hidden" name="business_name" value={lead.displayName ?? ''} />
          <input type="hidden" name="trade"         value={lead.trade} />
          <input type="hidden" name="city"          value={lead.city} />
          <input type="hidden" name="state"         value={lead.state} />
          <input type="hidden" name="place_id"      value={lead.placeId} />

          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Owner email (optional)
            <input
              name="owner_email"
              type="email"
              placeholder="owner@example.com"
              className="input"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={building}
              className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
            >
              {building ? '…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={building}
              onClick={() => setOpen(false)}
              className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
