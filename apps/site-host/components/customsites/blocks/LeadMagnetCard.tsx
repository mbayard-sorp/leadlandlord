'use client';

import { useState, type FormEvent } from 'react';
import type { CsLeadMagnetItem } from '@/lib/customsites-sanity';
import { CheckCircleIcon, DownloadIcon, ReportIcon } from '../icons';

interface Props {
  item: CsLeadMagnetItem;
  index: number;
  siteKey: string;
  /** Reassurance line under the gated form, from the block. */
  formFootnote?: string | null;
}

type Status = 'idle' | 'submitting' | 'done' | 'error';

/**
 * One lead-magnet card. Ungated: a plain download link. Gated: name + email
 * first — POST /api/cs-lead kind:"magnet" emails the firm the lead, emails
 * the visitor the link, and returns the URL so the download also starts
 * immediately.
 *
 * The gated form is a native <details> disclosure that slides open in the
 * card, not a modal. <details> rather than React state because the form must
 * still work with JS off: the browser opens it, and the real <form> POSTs to
 * the same route, which answers non-JS submits with a redirect to the PDF. A
 * state-toggled panel would render collapsed in the SSR HTML and strand those
 * visitors. The slide itself is progressive enhancement — browsers without
 * ::details-content just open it instantly.
 */
export function LeadMagnetCard({ item, index, siteKey, formFootnote }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

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
      // The url already carries ?dl=, so this downloads without navigating away.
      // Keep it and still render the button: if the browser blocks the
      // programmatic hit, the visitor has an explicit way to get the file.
      if (body.url) {
        setDownloadUrl(body.url);
        window.location.assign(body.url);
      }
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
        <a
          href={item.pdfUrl ?? '#'}
          className="cs-btn cs-magnet-cta"
          target="_blank"
          rel="noopener noreferrer"
        >
          <DownloadIcon className="cs-magnet-cta-icon" />
          {ctaLabel}
        </a>
      ) : (
        <details className="cs-magnet-disclosure" open={status !== 'idle'}>
          <summary className="cs-btn cs-magnet-cta">
            <DownloadIcon className="cs-magnet-cta-icon" />
            {ctaLabel}
          </summary>
          <div className="cs-magnet-reveal">
            {status === 'done' ? (
              <div className="cs-magnet-done" role="status">
                <CheckCircleIcon className="cs-magnet-done-mark" />
                <p className="cs-magnet-done-title">Your report is ready</p>
                <p className="cs-magnet-done-body">
                  Thanks — here&rsquo;s your {item.title}. We&rsquo;ve emailed you the link too.
                </p>
                {downloadUrl ? (
                  <a className="cs-btn cs-magnet-cta" href={downloadUrl}>
                    <DownloadIcon className="cs-magnet-cta-icon" />
                    Download PDF
                  </a>
                ) : null}
              </div>
            ) : (
              <>
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
                    <input
                      id={`magnet-${item._key}-company`}
                      name="company"
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>
                  {error ? (
                    <p className="cs-form-message cs-form-message--error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    className="cs-btn cs-magnet-cta"
                    disabled={status === 'submitting'}
                  >
                    {status === 'submitting' ? 'Sending…' : 'Email me the report'}
                  </button>
                </form>
                {formFootnote ? <p className="cs-magnet-footnote">{formFootnote}</p> : null}
              </>
            )}
          </div>
        </details>
      )}
    </article>
  );
}
