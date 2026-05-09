'use client';

import { useState, useTransition } from 'react';
import type { Site } from '@leadlandlord/db';
import { assignPhone, type PhoneAssignmentResult } from './actions';

interface Props {
  site: Site;
}

/**
 * Phone-assignment form on the site detail page.
 * Calls the `assignPhone` server action which writes the DB row and (when
 * Twilio creds are configured) updates the IncomingPhoneNumber's VoiceUrl.
 */
export function PhoneAssignmentForm({ site }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PhoneAssignmentResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('site_id', site.id);
    if (!fd.has('recording_enabled')) fd.set('recording_enabled', 'false');
    startTransition(async () => {
      setResult(null);
      const r = await assignPhone(fd);
      setResult(r);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4"
    >
      <header>
        <h3 className="text-sm font-semibold text-slate-200">Phone &amp; tracking</h3>
        <p className="text-xs text-slate-500 mt-1">
          Saving updates the DB. If Twilio Phone SID is set, also points its VoiceUrl at
          <code className="mx-1 px-1 py-0.5 bg-slate-800 rounded">/api/webhooks/twilio/voice</code>.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Tracking number">
          <input
            name="tracking_number"
            defaultValue={site.trackingNumber ?? ''}
            placeholder="+15125550100"
            className="input"
          />
        </Field>
        <Field label="Twilio phone SID">
          <input
            name="twilio_phone_sid"
            defaultValue={site.twilioPhoneSid ?? ''}
            placeholder="PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="input font-mono text-xs"
          />
        </Field>
        <Field label="Forwarding number">
          <input
            name="forwarding_number"
            defaultValue={site.forwardingNumber ?? ''}
            placeholder="+15125550199"
            className="input"
          />
        </Field>
        <Field label="Whisper message">
          <input
            name="whisper_message"
            defaultValue={site.whisperMessage ?? ''}
            placeholder={`Call from ${site.niche} ${site.city}`}
            className="input"
          />
        </Field>
        <Field label="Klaviyo list ID">
          <input
            name="klaviyo_list_id"
            defaultValue={site.klaviyoListId ?? ''}
            className="input font-mono text-xs"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          name="recording_enabled"
          value="true"
          defaultChecked={site.recordingEnabled}
          className="w-4 h-4"
        />
        Enable recording &amp; transcripts
      </label>

      {result && (
        <p className={`text-xs ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
          {result.message ?? (result.ok ? `Saved.${result.twilioUpdated ? ' Twilio webhook updated.' : ''}` : 'Save failed.')}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: rgb(15 23 42 / 0.6);
          border: 1px solid rgb(51 65 85);
          border-radius: 6px;
          padding: 8px 12px;
          color: rgb(226 232 240);
          font-size: 0.875rem;
        }
        :global(.input:focus) {
          outline: none;
          border-color: rgb(56 189 248);
        }
      `}</style>
    </form>
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
