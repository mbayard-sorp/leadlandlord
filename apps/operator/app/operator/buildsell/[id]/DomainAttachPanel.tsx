'use client';

import { useState, useTransition } from 'react';
import {
  attachBuildSellDomain,
  detachBuildSellDomain,
  verifyBuildSellDomainNow,
  type AttachDomainResult,
} from '../actions';

type DomainStatus = 'none' | 'pending' | 'verified';

interface Props {
  siteId: string;
  customDomain: string | null;
  domainStatus: DomainStatus;
  domainVerifiedAt: Date | null;
}

/**
 * B&S custom-domain panel — single domain per site (unlike R&R's
 * multi-domain DomainAttachForm). Three states keyed off domainStatus:
 *   'none'     — attach form.
 *   'pending'  — DNS records to set + "Verify now" / "Detach".
 *   'verified' — confirmation + "Detach" only.
 *
 * Server actions: attachBuildSellDomain, verifyBuildSellDomainNow,
 * detachBuildSellDomain (../actions.ts).
 */
export function DomainAttachPanel({ siteId, customDomain, domainStatus, domainVerifiedAt }: Props) {
  const [pending, startTransition] = useTransition();
  const [attachResult, setAttachResult] = useState<AttachDomainResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  function onAttach(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('id', siteId);
    setErrorMsg(null);
    setAttachResult(null);
    startTransition(async () => {
      const r = await attachBuildSellDomain(fd);
      if (!r.ok) {
        setErrorMsg(r.message ?? 'Attach failed.');
      } else {
        setAttachResult(r);
      }
    });
  }

  function onVerify() {
    const fd = new FormData();
    fd.set('id', siteId);
    setErrorMsg(null);
    setInfoMsg(null);
    startTransition(async () => {
      const r = await verifyBuildSellDomainNow(fd);
      if (!r.ok) {
        setErrorMsg(r.message ?? 'Verify failed.');
      } else {
        setInfoMsg(r.verified ? 'Verified.' : (r.message ?? 'Still pending.'));
      }
    });
  }

  function onDetach() {
    if (!confirm(`Detach ${customDomain} from this site?`)) return;
    const fd = new FormData();
    fd.set('id', siteId);
    setErrorMsg(null);
    setInfoMsg(null);
    startTransition(async () => {
      const r = await detachBuildSellDomain(fd);
      if (!r.ok) setErrorMsg(r.message ?? 'Detach failed.');
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-4">
      <header>
        <h2 className="text-sm font-semibold text-slate-300">Custom domain</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Attaches the customer&apos;s own domain (apex + www) via the Vercel Domains API and mirrors
          it onto the site&apos;s Sanity doc so Host-header resolution finds it.
        </p>
      </header>

      {domainStatus === 'none' && (
        <form onSubmit={onAttach} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 min-w-[220px] flex-1">
            <label htmlFor="da-domain" className="text-xs text-slate-400">
              Domain
            </label>
            <input
              id="da-domain"
              name="domain"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="tesshauling.com"
              required
              className="bg-slate-700/60 border border-slate-600/60 rounded px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 shrink-0"
          >
            {pending ? 'Attaching…' : 'Attach'}
          </button>
        </form>
      )}

      {domainStatus === 'pending' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Domain: <span className="font-mono">{customDomain}</span>{' '}
            <span className="px-1.5 py-0.5 rounded border border-amber-700/50 bg-amber-900/30 text-amber-300 text-[10px] uppercase tracking-wide align-middle">
              pending
            </span>
          </p>
          {attachResult?.dns && (
            <div className="rounded border border-sky-700/40 bg-sky-900/20 p-3 text-xs space-y-2">
              <p className="font-semibold text-sky-200">Set these DNS records at the registrar:</p>
              <DnsBlock label="A records (apex)" values={attachResult.dns.aValues} />
              <DnsBlock label="CNAME records (subdomain)" values={attachResult.dns.cnames} />
            </div>
          )}
          <p className="text-xs text-amber-400">
            Pending — DNS propagation can take minutes to hours.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onVerify}
              disabled={pending}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-50"
            >
              {pending ? 'Checking…' : 'Verify now'}
            </button>
            <button
              type="button"
              onClick={onDetach}
              disabled={pending}
              className="px-3 py-1.5 text-sm rounded bg-red-900/40 hover:bg-red-900/60 text-red-300 disabled:opacity-50"
            >
              Detach
            </button>
          </div>
        </div>
      )}

      {domainStatus === 'verified' && (
        <div className="space-y-3">
          <p className="text-sm text-emerald-400">
            Domain <span className="font-mono">{customDomain}</span> is live and verified.
            {domainVerifiedAt && (
              <span className="text-slate-500"> (verified {domainVerifiedAt.toLocaleDateString()})</span>
            )}
          </p>
          <button
            type="button"
            onClick={onDetach}
            disabled={pending}
            className="px-3 py-1.5 text-sm rounded bg-red-900/40 hover:bg-red-900/60 text-red-300 disabled:opacity-50"
          >
            Detach
          </button>
        </div>
      )}

      {errorMsg && <p className="text-xs text-red-400">Error: {errorMsg}</p>}
      {infoMsg && <p className="text-xs text-emerald-400">{infoMsg}</p>}
    </section>
  );
}

function DnsBlock({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <p className="text-slate-400">{label}:</p>
      <ul className="ml-4 list-disc text-slate-200 font-mono">
        {values.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
    </div>
  );
}
