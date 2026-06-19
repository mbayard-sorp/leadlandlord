'use client';

import { useTransition, useState, useEffect } from 'react';
import { runBuildSellSearch, buildDraft, markCalled, saveLeadNote, setFollowUp } from './actions';
import type { SearchLead } from './types';

const STORAGE_KEY = 'buildsell:lastSearch';

export function SearchPanel() {
  const [searching, startSearch] = useTransition();
  const [leads, setLeads] = useState<SearchLead[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore the last search results on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SearchLead[];
        if (Array.isArray(parsed)) setLeads(parsed);
      }
    } catch {
      // Ignore malformed/inaccessible storage.
    }
    setHydrated(true);
  }, []);

  // Persist results until manually cleared.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (leads !== null) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
      }
    } catch {
      // Ignore storage write failures (quota, private mode, etc.).
    }
  }, [leads, hydrated]);

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

  function handleClear() {
    setLeads(null);
    setSearchError(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage removal failures.
    }
  }

  function updateLead(placeId: string, patch: Partial<SearchLead>) {
    setLeads((prev) =>
      prev
        ? prev.map((l) => (l.placeId === placeId ? { ...l, ...patch } : l))
        : prev,
    );
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
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-xs text-slate-500">
              {leads.length === 0
                ? 'No leads found.'
                : `${leads.length} lead${leads.length === 1 ? '' : 's'} found — no-website leads are prime prospects.`}
            </p>
            <button
              type="button"
              onClick={handleClear}
              className="shrink-0 rounded bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-medium text-slate-300"
            >
              Clear results
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {leads.map((lead) => (
              <LeadCard key={lead.placeId} lead={lead} onUpdate={updateLead} />
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

// ─── Snapshot helper ─────────────────────────────────────────────────────────

/**
 * Appends the Places snapshot hidden fields to a FormData so the server action
 * can lazy-persist the lead's display data on the first CRM interaction.
 */
function appendSnapshot(fd: FormData, lead: SearchLead) {
  const s: Array<[string, string | number | null | undefined]> = [
    ['place_id', lead.placeId],
    ['display_name', lead.displayName],
    ['formatted_address', lead.formattedAddress],
    ['national_phone', lead.nationalPhone],
    ['primary_type', lead.primaryType],
    ['rating', lead.rating],
    ['user_rating_count', lead.userRatingCount],
    ['website_uri', lead.websiteUri],
    ['lat', lead.lat],
    ['lng', lead.lng],
    ['trade', lead.trade],
    ['city', lead.city],
    ['state', lead.state],
  ];
  for (const [k, v] of s) {
    fd.set(k, v == null ? '' : String(v));
  }
}

// ─── Lead card ───────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  onUpdate,
}: {
  lead: SearchLead;
  onUpdate: (placeId: string, patch: Partial<SearchLead>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [building, startBuild] = useTransition();
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [buildOk, setBuildOk] = useState<boolean | null>(null);

  // CRM local state (seeded from initial lead data, kept in sync via onUpdate)
  const [callingPending, startCalling] = useTransition();
  const [notePending, startNote] = useTransition();
  const [followUpPending, startFollowUp] = useTransition();
  const [noteText, setNoteText] = useState(lead.note ?? '');
  const [noteSaved, setNoteSaved] = useState(false);
  const [followUpInput, setFollowUpInput] = useState(lead.followUpAt ?? '');
  const [followUpSaved, setFollowUpSaved] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);

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

  function handleCalledToggle() {
    const newCalled = !lead.called;
    const fd = new FormData();
    fd.set('called', String(newCalled));
    appendSnapshot(fd, lead);
    setCrmError(null);
    startCalling(async () => {
      const result = await markCalled(fd);
      if (result.ok) {
        onUpdate(lead.placeId, {
          called: result.called ?? newCalled,
          calledAt: result.calledAt ?? null,
        });
      } else {
        setCrmError(result.message ?? 'Failed to update called status.');
      }
    });
  }

  function handleSaveNote() {
    const fd = new FormData();
    fd.set('note', noteText);
    appendSnapshot(fd, lead);
    setNoteSaved(false);
    setCrmError(null);
    startNote(async () => {
      const result = await saveLeadNote(fd);
      if (result.ok) {
        onUpdate(lead.placeId, { note: result.note ?? null });
        setNoteSaved(true);
      } else {
        setCrmError(result.message ?? 'Failed to save note.');
      }
    });
  }

  function handleSetFollowUp(clear = false) {
    const fd = new FormData();
    fd.set('follow_up_at', clear ? '' : followUpInput);
    appendSnapshot(fd, lead);
    setFollowUpSaved(false);
    setCrmError(null);
    startFollowUp(async () => {
      const result = await setFollowUp(fd);
      if (result.ok) {
        const newDate = result.followUpAt ?? null;
        onUpdate(lead.placeId, { followUpAt: newDate });
        setFollowUpInput(newDate ?? '');
        setFollowUpSaved(true);
      } else {
        setCrmError(result.message ?? 'Failed to set follow-up.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-2">
      {/* Name + website badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-slate-200 text-sm">{lead.displayName ?? '(unnamed)'}</div>
        {lead.hasWebsite ? (
          <span className="shrink-0 inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-amber-900/50 text-amber-300">
            Has site
          </span>
        ) : (
          <span className="shrink-0 inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-emerald-900/60 text-emerald-300">
            No website
          </span>
        )}
      </div>

      {/* Website link when present */}
      {lead.hasWebsite && lead.websiteUri && (
        <div className="text-xs truncate">
          <a
            href={lead.websiteUri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline"
          >
            {lead.websiteUri}
          </a>
        </div>
      )}

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

      {/* CRM error */}
      {crmError && <p className="text-xs text-red-400">{crmError}</p>}

      {/* Called checkbox */}
      <div className="border-t border-slate-800/60 pt-2 space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lead.called}
            disabled={callingPending}
            onChange={handleCalledToggle}
            className="accent-emerald-500"
          />
          <span>Called</span>
          {lead.called && lead.calledAt && (
            <span className="text-slate-500 font-normal">
              — {new Date(lead.calledAt).toLocaleDateString()}
            </span>
          )}
          {callingPending && <span className="text-slate-600">…</span>}
        </label>

        {/* Note */}
        <div className="space-y-1">
          <textarea
            value={noteText}
            onChange={(e) => { setNoteText(e.target.value); setNoteSaved(false); }}
            placeholder="Add a note…"
            rows={2}
            className="input w-full resize-none text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={notePending}
              onClick={handleSaveNote}
              className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-2 py-0.5 text-xs font-medium text-slate-100"
            >
              {notePending ? '…' : 'Save note'}
            </button>
            {noteSaved && <span className="text-xs text-emerald-400">Saved</span>}
          </div>
        </div>

        {/* Follow-up date */}
        <div className="space-y-1">
          <label className="text-xs text-slate-400">Follow-up date</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={followUpInput}
              onChange={(e) => { setFollowUpInput(e.target.value); setFollowUpSaved(false); }}
              className="input text-xs py-0.5"
            />
            <button
              type="button"
              disabled={followUpPending || !followUpInput}
              onClick={() => handleSetFollowUp(false)}
              className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-2 py-0.5 text-xs font-medium text-slate-100"
            >
              {followUpPending ? '…' : 'Set'}
            </button>
            {lead.followUpAt && (
              <button
                type="button"
                disabled={followUpPending}
                onClick={() => handleSetFollowUp(true)}
                className="rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-2 py-0.5 text-xs text-slate-400"
              >
                Clear
              </button>
            )}
            {followUpSaved && <span className="text-xs text-emerald-400">Set</span>}
          </div>
        </div>
      </div>

      {/* Build draft */}
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
          <input type="hidden" name="business_name"     value={lead.displayName ?? ''} />
          <input type="hidden" name="trade"             value={lead.trade} />
          <input type="hidden" name="city"              value={lead.city} />
          <input type="hidden" name="state"             value={lead.state} />
          <input type="hidden" name="place_id"          value={lead.placeId} />
          {lead.rating != null && (
            <input type="hidden" name="rating"          value={String(lead.rating)} />
          )}
          {lead.userRatingCount != null && (
            <input type="hidden" name="user_rating_count" value={String(lead.userRatingCount)} />
          )}
          {lead.primaryType && (
            <input type="hidden" name="primary_type"   value={lead.primaryType} />
          )}

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
