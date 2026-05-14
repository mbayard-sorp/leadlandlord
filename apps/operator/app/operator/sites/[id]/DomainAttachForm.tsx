'use client';

import { useState, useTransition } from 'react';
import { attachDomain, detachDomain, verifyDomainNow, type AttachDomainResult } from './actions';

interface Domain {
  host: string;
  isPrimary?: boolean;
  verified?: boolean;
  attachedAt?: string;
}

interface Props {
  siteId: string;
  domains: Domain[];
}

/**
 * Domain manager for the site detail page.
 *
 * - Lists currently-attached domains with verified/pending status
 * - "Verify now" button polls Vercel + flips Sanity flag
 * - "Detach" removes from both Vercel + Sanity
 * - Form below attaches a new domain — calls Vercel Domains API + records
 *   in Sanity site doc's domains[]; result panel shows the DNS records
 *   the operator needs to set at their registrar.
 */
export function DomainAttachForm({ siteId, domains }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AttachDomainResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function onAttach(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('site_id', siteId);
    setResult(null);
    setErrorMsg(null);
    startTransition(async () => {
      const r = await attachDomain(fd);
      if (!r.ok) {
        setErrorMsg(r.message ?? 'attach failed');
      } else {
        setResult(r);
        form.reset();
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <header>
        <h3 className="text-sm font-semibold text-slate-200">Custom domains</h3>
        <p className="text-xs text-slate-500 mt-1">
          Attaches via the Vercel Domains API and writes to the Sanity site doc. The cron at
          <code className="mx-1 px-1 py-0.5 bg-slate-800 rounded">/api/cron/domain-verifier</code>
          flips <code className="px-1 py-0.5 bg-slate-800 rounded">verified</code> automatically every 5 minutes once DNS is correct.
        </p>
      </header>

      {domains.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-500">
          No domains attached yet. Add one below.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 rounded border border-slate-800">
          {domains.map((d) => (
            <DomainRow key={d.host} siteId={siteId} domain={d} />
          ))}
        </ul>
      )}

      <form onSubmit={onAttach} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Hostname</span>
          <input
            name="host"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="example.com or www.example.com"
            required
            className="w-full min-h-[44px] bg-slate-950/40 border border-slate-700 rounded px-3 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
          />
        </label>
        <label className="inline-flex items-center min-h-[44px] gap-2 text-sm text-slate-300">
          <input type="checkbox" name="is_primary" value="true" className="w-5 h-5" />
          Primary
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[44px] px-4 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Attaching…' : 'Attach'}
        </button>
      </form>

      {errorMsg && (
        <p className="text-xs text-red-300">
          Attach failed: <span className="font-mono">{errorMsg}</span>
        </p>
      )}

      {result && result.config && (
        <div className="rounded border border-sky-700/40 bg-sky-900/20 p-3 text-xs space-y-2">
          <p className="font-semibold text-sky-200">
            Attached. Now set these DNS records at your registrar:
          </p>
          {result.config.aValues && result.config.aValues.length > 0 && (
            <DnsBlock label="A records (apex)" values={result.config.aValues} />
          )}
          {result.config.cnames && result.config.cnames.length > 0 && (
            <DnsBlock label="CNAME records (subdomain)" values={result.config.cnames} />
          )}
          <p className="text-slate-400">
            Verification status: {result.verified ? <span className="text-emerald-300">verified</span> : <span className="text-amber-300">pending — DNS propagation can take minutes to hours.</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function DomainRow({ siteId, domain }: { siteId: string; domain: Domain }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | undefined>(domain.verified);

  function verify() {
    const fd = new FormData();
    fd.set('site_id', siteId);
    fd.set('host', domain.host);
    setMsg(null);
    startTransition(async () => {
      const r = await verifyDomainNow(fd);
      if (r.ok) {
        setVerified(r.verified);
        setMsg(r.verified ? 'Verified.' : 'Still pending — check DNS.');
      } else {
        setMsg(r.message ?? 'verify failed');
      }
    });
  }

  function detach() {
    if (!confirm(`Detach ${domain.host} from this site?`)) return;
    const fd = new FormData();
    fd.set('site_id', siteId);
    fd.set('host', domain.host);
    setMsg(null);
    startTransition(async () => {
      const r = await detachDomain(fd);
      if (!r.ok) setMsg(r.message ?? 'detach failed');
    });
  }

  return (
    <li className="px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono flex-1 min-w-0 break-words">{domain.host}</span>
      {domain.isPrimary && (
        <span className="px-1.5 py-0.5 rounded border border-sky-700/50 bg-sky-900/30 text-sky-300 text-[10px] uppercase tracking-wide">primary</span>
      )}
      {verified ? (
        <span className="px-1.5 py-0.5 rounded border border-emerald-700/50 bg-emerald-900/30 text-emerald-300 text-[10px] uppercase tracking-wide">verified</span>
      ) : (
        <span className="px-1.5 py-0.5 rounded border border-amber-700/50 bg-amber-900/30 text-amber-300 text-[10px] uppercase tracking-wide">pending</span>
      )}
      <button
        type="button"
        onClick={verify}
        disabled={pending}
        className="inline-flex items-center min-h-[44px] px-2 text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50"
      >
        Verify now
      </button>
      <button
        type="button"
        onClick={detach}
        disabled={pending}
        className="inline-flex items-center min-h-[44px] px-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        Detach
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </li>
  );
}

function DnsBlock({ label, values }: { label: string; values: string[] }) {
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
