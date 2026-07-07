'use client';

import { useState, useTransition } from 'react';
import { updateOwnerEmail, retryKlaviyoList } from './lead-forwarding-actions';

interface Props {
  siteId: string;
  initialOwnerEmail: string | null;
  initialKlaviyoListId: string | null;
}

/**
 * Operator panel for the two lead-forwarding destinations on a B&S site:
 *   - Owner email: where /api/bs/lead forwards each submission via Resend.
 *   - Klaviyo list: where each lead's profile is subscribed.
 *
 * Both are Postgres-authoritative (buildsell_sites.owner_email /
 * klaviyo_list_id) — the values /api/bs/lead actually reads. Saving here
 * also mirrors into the Sanity doc's hidden ownerEmail/klaviyoListId fields
 * so they're visible in Studio; Studio edits do NOT flow back here.
 *
 * Server actions: updateOwnerEmail, retryKlaviyoList (lead-forwarding-actions.ts).
 */
export function LeadForwardingPanel({ siteId, initialOwnerEmail, initialKlaviyoListId }: Props) {
  const [ownerEmail, setOwnerEmail] = useState(initialOwnerEmail ?? '');
  const [klaviyoListId, setKlaviyoListId] = useState(initialKlaviyoListId);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [klaviyoMsg, setKlaviyoMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSaveEmail(formData: FormData) {
    setEmailMsg(null);
    startTransition(async () => {
      const result = await updateOwnerEmail(formData);
      setEmailMsg(result.ok ? (result.message ?? 'Saved.') : `Error: ${result.message}`);
    });
  }

  function handleRetryKlaviyo() {
    setKlaviyoMsg(null);
    startTransition(async () => {
      const result = await retryKlaviyoList(siteId);
      if (result.ok) {
        setKlaviyoListId(result.klaviyoListId ?? null);
      }
      setKlaviyoMsg(result.ok ? (result.message ?? 'Done.') : `Error: ${result.message}`);
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-4">
      <header>
        <h2 className="text-sm font-semibold text-slate-300">Lead Forwarding</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Where each contact-form submission goes: an email notification and a Klaviyo list subscription.
        </p>
      </header>

      {/* Owner email */}
      <form action={handleSaveEmail} className="flex flex-wrap gap-2 items-end">
        <input type="hidden" name="site_id" value={siteId} />
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label htmlFor="lf-email" className="text-xs text-slate-400">
            Forward leads to
          </label>
          <input
            id="lf-email"
            name="owner_email"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="owner@example.com"
            className="bg-slate-700/60 border border-slate-600/60 rounded px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 shrink-0"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {emailMsg && (
        <p className={`text-xs ${emailMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
          {emailMsg}
        </p>
      )}

      {/* Klaviyo list */}
      <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-slate-700/40">
        <div className="text-xs text-slate-400 min-w-[220px]">
          <p className="mb-0.5">Klaviyo list</p>
          {klaviyoListId ? (
            <p className="font-mono text-slate-300">{klaviyoListId}</p>
          ) : (
            <p className="text-amber-400">Not yet created</p>
          )}
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={handleRetryKlaviyo}
          className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-50 shrink-0"
        >
          {isPending ? 'Working…' : klaviyoListId ? 'Retry' : 'Create list'}
        </button>
      </div>
      {klaviyoMsg && (
        <p className={`text-xs ${klaviyoMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
          {klaviyoMsg}
        </p>
      )}
    </section>
  );
}
