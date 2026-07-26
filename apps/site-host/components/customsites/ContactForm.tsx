'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  siteKey: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = 'firstName' | 'lastName' | 'email' | 'message';

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  // Move focus to whichever feedback just appeared — a screen reader user
  // submitting via keyboard otherwise has no signal anything happened.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const fd = new FormData(e.currentTarget);
    const firstName = String(fd.get('firstName') ?? '').trim();
    const lastName = String(fd.get('lastName') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const message = String(fd.get('message') ?? '').trim();

    const nextFieldErrors: Partial<Record<FieldName, string>> = {};
    if (!firstName) nextFieldErrors.firstName = 'First name is required.';
    if (!lastName) nextFieldErrors.lastName = 'Last name is required.';
    if (!email) nextFieldErrors.email = 'Email is required.';
    else if (!EMAIL_RE.test(email)) nextFieldErrors.email = 'Enter a valid email address.';
    if (!message) nextFieldErrors.message = 'Message is required.';

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError('Please fix the highlighted fields below.');
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
      <p
        ref={successRef}
        tabIndex={-1}
        role="status"
        className="cs-form-message cs-form-message--success"
      >
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
          <input
            id="cs-firstName"
            name="firstName"
            type="text"
            required
            className="cs-form-input"
            autoComplete="given-name"
            aria-invalid={fieldErrors.firstName ? true : undefined}
            aria-describedby={fieldErrors.firstName ? 'cs-firstName-error' : undefined}
          />
          {fieldErrors.firstName ? (
            <p id="cs-firstName-error" className="cs-form-field-error">
              {fieldErrors.firstName}
            </p>
          ) : null}
        </div>
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-lastName">
            Last name <span className="cs-form-required">*</span>
          </label>
          <input
            id="cs-lastName"
            name="lastName"
            type="text"
            required
            className="cs-form-input"
            autoComplete="family-name"
            aria-invalid={fieldErrors.lastName ? true : undefined}
            aria-describedby={fieldErrors.lastName ? 'cs-lastName-error' : undefined}
          />
          {fieldErrors.lastName ? (
            <p id="cs-lastName-error" className="cs-form-field-error">
              {fieldErrors.lastName}
            </p>
          ) : null}
        </div>
      </div>
      <div className="cs-form-row">
        <div className="cs-form-field">
          <label className="cs-form-label" htmlFor="cs-email">
            Email <span className="cs-form-required">*</span>
          </label>
          <input
            id="cs-email"
            name="email"
            type="email"
            required
            className="cs-form-input"
            autoComplete="email"
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'cs-email-error' : undefined}
          />
          {fieldErrors.email ? (
            <p id="cs-email-error" className="cs-form-field-error">
              {fieldErrors.email}
            </p>
          ) : null}
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
        <textarea
          id="cs-message"
          name="message"
          required
          rows={5}
          className="cs-form-textarea"
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={fieldErrors.message ? 'cs-message-error' : undefined}
        />
        {fieldErrors.message ? (
          <p id="cs-message-error" className="cs-form-field-error">
            {fieldErrors.message}
          </p>
        ) : null}
      </div>

      {/* Honeypot — hidden from sighted users and screen readers via CSS,
          left in the tab order intentionally so bots that fill every field
          trip it (aria-hidden would also hide it from bots that inspect
          computed accessibility, defeating the purpose). */}
      <div className="cs-form-honeypot">
        <label htmlFor="cs-company">Company</label>
        <input id="cs-company" name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p ref={errorRef} tabIndex={-1} role="alert" className="cs-form-message cs-form-message--error">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="cs-btn cs-btn-primary" style={{ marginTop: 8 }}>
        {pending ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}
