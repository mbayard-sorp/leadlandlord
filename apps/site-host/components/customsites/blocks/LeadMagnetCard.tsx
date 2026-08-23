'use client';

import { useState, type FormEvent } from 'react';
import type { CsLeadMagnetItem } from '@/lib/customsites-sanity';
import { DownloadIcon, ReportIcon } from '../icons';

interface Props {
  item: CsLeadMagnetItem;
  index: number;
  siteKey: string;
}

type Status = 'idle' | 'form' | 'submitting' | 'done' | 'error';

/**
 * One lead-magnet card. Ungated: a plain download link. Gated: name + email
 * first — POST /api/cs-lead kind:"magnet" emails the firm the lead, emails
 * the visitor the link, and returns the URL so the download also starts
 * immediately. No-JS fallback: the form is a real <form> POSTing to the same
 * route; the route answers non-JS submits with a redirect to the PDF.
 */
export function LeadMagnetCard({ item, index, siteKey }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const gated = item.gated !== false;
  const ctaLabel = item.ctaLabel?.trim() || 'Get the report';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/cs-lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'magnet',
          siteKey,
          assetId: item.pdfAssetId,
          firstName: String(data.get('firstName') ?? ''),
          lastName: String(data.get('lastName') ?? ''),
          email: String(data.get('email') ?? ''),
          company: String(data.get('company') ?? ''),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
      if (!res.ok || !body?.ok) throw new Error('request_failed');
      setStatus('done');
      if (body.url) window.location.assign(body.url);
    } catch {
      setStatus('error');
      setError('Something went wrong. Please try again, or use the contact form below.');
    }
  }

  return (
    <article className="cs-magnet-card">
      <span className="cs-magnet-icon" aria-hidden="true">
        <ReportIcon />
      </span>
      <span className="cs-magnet-index" aria-hidden="true">
        {String(index).padStart(2, '0')}
      </span>
      <h3>{item.title}</h3>
      <p className="cs-card-excerpt">{item.body}</p>

      {!gated ? (
        <a href={item.pdfUrl ?? '#'} className="cs-btn cs-magnet-cta" target="_blank" rel="noopener noreferrer">
          <DownloadIcon className="cs-magnet-cta-icon" />
          {ctaLabel}
        </a>
      ) : status === 'idle' ? (
        <button type="button" className="cs-btn cs-magnet-cta" onClick={() => setStatus('form')}>
          <DownloadIcon className="cs-magnet-cta-icon" />
          {ctaLabel}
        </button>
      ) : status === 'done' ? (
        <p className="cs-form-message cs-form-message--success" role="status">
          Check your inbox — the report link is on its way. Your download should also start automatically.
        </p>
      ) : (
        <form method="post" action="/api/cs-lead" onSubmit={onSubmit}>
          <input type="hidden" name="kind" value="magnet" />
          <input type="hidden" name="siteKey" value={siteKey} />
          <input type="hidden" name="assetId" value={item.pdfAssetId ?? ''} />
          <div className="cs-form-row">
            <div className="cs-form-field">
              <label className="cs-form-label" htmlFor={`magnet-${item._key}-first`}>
                First Name<span className="cs-form-required"> *</span>
              </label>
              <input
                id={`magnet-${item._key}-first`}
                name="firstName"
                className="cs-form-input"
                required
                autoComplete="given-name"
              />
            </div>
            <div className="cs-form-field">
              <label className="cs-form-label" htmlFor={`magnet-${item._key}-last`}>
                Last Name<span className="cs-form-required"> *</span>
              </label>
              <input
                id={`magnet-${item._key}-last`}
                name="lastName"
                className="cs-form-input"
                required
                autoComplete="family-name"
              />
            </div>
          </div>
          <div className="cs-form-field">
            <label className="cs-form-label" htmlFor={`magnet-${item._key}-email`}>
              Email<span className="cs-form-required"> *</span>
            </label>
            <input
              id={`magnet-${item._key}-email`}
              name="email"
              type="email"
              className="cs-form-input"
              required
              autoComplete="email"
            />
          </div>
          {/* Honeypot — same convention as ContactForm (#cs-company). */}
          <div className="cs-form-honeypot" aria-hidden="true">
            <label htmlFor={`magnet-${item._key}-company`}>Company</label>
            <input id={`magnet-${item._key}-company`} name="company" tabIndex={-1} autoComplete="off" />
          </div>
          {error ? (
            <p className="cs-form-message cs-form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="cs-btn cs-btn-primary" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending…' : 'Email me the report'}
          </button>
        </form>
      )}
    </article>
  );
}
