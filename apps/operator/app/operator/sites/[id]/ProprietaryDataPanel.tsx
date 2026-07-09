'use client';

import { useState, useTransition } from 'react';
import { saveProprietaryData } from './actions';
import { Timestamp } from '../../../../components/Timestamp';

interface Props {
  siteId: string;
  initial: {
    caseStudyInputs: string;
    firsthandInputs: string;
    contrarianTakes: string;
    proprietaryFacts: string;
    expertiseProfile: string;
    gbpUrl: string;
    socials: string;
  };
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * Postgres-backed proprietary-inputs form. The agents read these to ground
 * non-commodity content (case studies, firsthand reviews, contrarian takes,
 * E-E-A-T author bylines) and the contractor's real GBP/social links (rendered
 * as the site's organization-schema sameAs[]).
 *
 * JSON-textarea-per-jsonb-column — deliberately lightweight. Each array column
 * takes a JSON array of objects; the shape hints in the helper text mirror the
 * agent read path.
 */
export function ProprietaryDataPanel({ siteId, initial, updatedBy, updatedAt }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('site_id', siteId);
    setMsg(null);
    startTransition(async () => {
      const r = await saveProprietaryData(fd);
      setMsg(r.ok ? { ok: true, text: r.message ?? 'Saved. Agents read these on the next content run.' } : { ok: false, text: r.message ?? 'save failed' });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4"
    >
      <header>
        <h3 className="text-sm font-semibold text-slate-200">Proprietary data</h3>
        <p className="text-xs text-slate-500 mt-1">
          Stored in Postgres (off the public dataset). Grounds original content + E-E-A-T bylines. Empty fields are auto-filled weekly by the data-inputs-scaffolder (seeds tagged illustrative); anything entered here wins and is never overwritten. Generated copy still queues through the normal approval gate.
        </p>
        {updatedAt && (
          <p className="text-[11px] text-slate-600 mt-1">
            Last saved <Timestamp value={updatedAt} /> by {updatedBy ?? 'operator'}
          </p>
        )}
      </header>

      <JsonField
        name="case_study_inputs"
        label="Case studies"
        hint='JSON array of { problem, solution, outcome, city, jobType }'
        defaultValue={initial.caseStudyInputs}
        rows={6}
      />
      <JsonField
        name="firsthand_inputs"
        label="Firsthand notes"
        hint='JSON array of { subject, experience, verdict }'
        defaultValue={initial.firsthandInputs}
        rows={5}
      />
      <JsonField
        name="contrarian_takes"
        label="Contrarian takes"
        hint='JSON array of { claim, reasoning, evidence } — human-only; the scaffolder never fills this'
        defaultValue={initial.contrarianTakes}
        rows={5}
      />
      <JsonField
        name="proprietary_facts"
        label="Proprietary facts"
        hint='JSON object of vouched facts (hours, certifications, equipment, guarantees). sameAs is managed via the fields below.'
        defaultValue={initial.proprietaryFacts}
        rows={4}
      />
      <JsonField
        name="expertise_profile"
        label="Expertise profile (E-E-A-T)"
        hint='JSON object — e.g. { authorName, authorTitle, authorBio }. Drives author schema + bylines.'
        defaultValue={initial.expertiseProfile}
        rows={4}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Real Google Business Profile URL">
          <input
            name="gbp_url"
            defaultValue={initial.gbpUrl}
            placeholder="https://g.page/..."
            autoCorrect="off"
            spellCheck={false}
            className="input"
          />
        </Field>
        <Field label="Social profile URLs (one per line / comma-separated)">
          <textarea
            name="socials"
            defaultValue={initial.socials}
            placeholder={'https://facebook.com/...\nhttps://instagram.com/...'}
            rows={3}
            className="input font-mono text-xs"
            style={{ minHeight: 'auto' }}
          />
        </Field>
      </div>
      <p className="text-[11px] text-slate-600">
        The GBP URL + socials are written into proprietaryFacts.sameAs and rendered as the site&apos;s organization-schema sameAs[]. Use the contractor&apos;s real listings only.
      </p>

      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center min-h-[44px] px-4 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function JsonField({
  name,
  label,
  hint,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      <span className="block text-[11px] text-slate-600 mb-1">{hint}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows}
        className="input font-mono text-xs"
        style={{ minHeight: 'auto' }}
        spellCheck={false}
        autoCorrect="off"
      />
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
