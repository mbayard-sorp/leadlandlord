'use client';

import { useState, useTransition } from 'react';
import { setSiteConfig } from './actions';

interface Props {
  siteId: string;
  initial: {
    gaMeasurementId: string | null;
    robotsDisallow: boolean | null;
    primaryHost: string | null;
  };
  domainHosts: string[];
}

/**
 * Sanity-backed site config form. Replaces the legacy per-tenant Vercel
 * env-vars table — every site is now rendered out of the shared
 * `leadlandlord-sites` Vercel project, so per-site config lives in Sanity
 * (gaMeasurementId, robotsDisallow, which domain is primary).
 */
export function SiteConfigPanel({ siteId, initial, domainHosts }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('site_id', siteId);
    if (!fd.has('robots_disallow')) fd.set('robots_disallow', 'false');
    setMsg(null);
    startTransition(async () => {
      const r = await setSiteConfig(fd);
      if (!r.ok) {
        setMsg({ ok: false, text: r.message ?? 'save failed' });
      } else {
        setMsg({ ok: true, text: 'Saved. Live site picks up changes on next Sanity replication.' });
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4"
    >
      <header>
        <h3 className="text-sm font-semibold text-slate-200">Site config</h3>
        <p className="text-xs text-slate-500 mt-1">
          Sanity-backed. Operator-controlled fields the agents leave alone.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="GA4 measurement ID">
          <input
            name="ga_measurement_id"
            defaultValue={initial.gaMeasurementId ?? ''}
            placeholder="G-XXXXXXXXXX"
            className="input font-mono text-xs"
          />
        </Field>
        {domainHosts.length > 0 ? (
          <Field label="Primary domain">
            <select
              name="primary_host"
              defaultValue={initial.primaryHost ?? domainHosts[0]}
              className="input"
            >
              {domainHosts.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Primary domain">
            <p className="text-xs text-slate-500 italic mt-2">No domains attached yet.</p>
          </Field>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          name="robots_disallow"
          value="true"
          defaultChecked={initial.robotsDisallow ?? true}
          className="w-4 h-4"
        />
        Block all crawlers (robots.txt → Disallow:&nbsp;/)
      </label>
      <p className="text-xs text-slate-500">
        Keep checked while the site is in warming mode and serving placeholder copy. Uncheck once content is final and you want Google to index.
      </p>

      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
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
