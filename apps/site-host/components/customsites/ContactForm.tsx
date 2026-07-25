'use client';

import { useState } from 'react';

interface Props {
  siteKey: string;
}

/**
 * Custom Sites lead form (ADR 0033 D4). Posts to /api/cs-lead (Phase 4 —
 * Zod validation + honeypot + rate limit + Resend, no DB write, no
 * agent_events row). Client contract:
 *   POST { siteKey, firstName, lastName, email, phone?, message, company }
 *   -> 200 { ok: true } | 4xx { error: string }
 * `company` is the honeypot field (hidden via CSS, real users never fill it).
 */
export function ContactForm({ siteKey }: Props) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const firstName = String(fd.get('firstName') ?? '').trim();
    const lastName = String(fd.get('lastName') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const message = String(fd.get('message') ?? '').trim();

    if (!firstName || !lastName || !email || !message) {
      setError('Please fill in your name, email, and message.');
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/cs-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteKey,
          firstName,
          lastName,
          email,
          phone: String(fd.get('phone') ?? '').trim() || undefined,
          message,
          company: fd.get('company'),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Submit failed (${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="cs-form-message cs-form-message--success">
        Thank you — your message has been received. We will be in touch shortly.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="cs-form-row">
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-firstName">
            First name <span className="cs-form-required">*</span>
          </label>
          <input id="cs-firstName" name="firstName" type="text" required className="cs-form-input" autoComplete="given-name" />
        </div>
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-lastName">
            Last name <span className="cs-form-required">*</span>
          </label>
          <input id="cs-lastName" name="lastName" type="text" required className="cs-form-input" autoComplete="family-name" />
        </div>
      </div>
      <div className="cs-form-row">
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-email">
            Email <span className="cs-form-required">*</span>
          </label>
          <input id="cs-email" name="email" type="email" required className="cs-form-input" autoComplete="email" />
        </div>
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-phone">
            Phone
          </label>
          <input id="cs-phone" name="phone" type="tel" className="cs-form-input" autoComplete="tel" />
        </div>
      </div>
      <div className="cs-form-field">
        <label className="cs-form-label" htmlFor="cs-message">
          Message <span className="cs-form-required">*</span>
        </label>
        <textarea id="cs-message" name="message" required rows={5} className="cs-form-textarea" />
      </div>

      {/* Honeypot — hidden from sighted users and screen readers via CSS,
          left in the tab order intentionally so bots that fill every field
          trip it (aria-hidden would also hide it from bots that inspect
          computed accessibility, defeating the purpose). */}
      <div className="cs-form-honeypot">
        <label htmlFor="cs-company">Company</label>
        <input id="cs-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? <p className="cs-form-message cs-form-message--error">{error}</p> : null}

      <button type="submit" disabled={pending} className="cs-btn cs-btn-primary" style={{ marginTop: 8 }}>
        {pending ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}
