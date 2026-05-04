'use client';

import { useState } from 'react';

interface Props {
  /** Visual variant — controls input/button styling via CSS classes. */
  variant: 'classic' | 'modern' | 'premium' | 'bright';
  /** Optional headline ("Get a free quote"). */
  heading?: string;
  /** Optional subhead ("Reply same business day"). */
  sub?: string;
  /** Submit-button label. */
  submit?: string;
  /** Source page key — sent with the submission so /api/lead can route by site. */
  source?: string;
}

/**
 * The 4-field lead form per shared rule §01.
 *
 *   name · phone (required) · zip · message
 *   honeypot field (anti-bot)
 *   posts to /api/lead → email + Klaviyo (when integration lands)
 */
export function LeadForm({ variant, heading, sub, submit = 'Send →', source = 'home' }: Props) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    if (fd.get('website')) {
      // Honeypot tripped — silently succeed.
      setDone(true);
      setPending(false);
      return;
    }
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'),
          phone: fd.get('phone'),
          zip: fd.get('zip'),
          message: fd.get('message'),
          source,
        }),
      });
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="leadform-success">
        <p>Got it — we'll be in touch shortly.</p>
        <p className="leadform-success-phone">Or call us right now if it's urgent.</p>
      </div>
    );
  }

  const cls = `leadform leadform-${variant}`;
  return (
    <form onSubmit={onSubmit} className={cls} noValidate>
      {heading && <h3 className="leadform-heading">{heading}</h3>}
      {sub && <p className="leadform-sub">{sub}</p>}
      <input
        type="text"
        name="name"
        placeholder="Your name"
        autoComplete="name"
        required
        className="leadform-input"
      />
      <input
        type="tel"
        name="phone"
        placeholder="Phone"
        autoComplete="tel"
        required
        className="leadform-input"
      />
      <input
        type="text"
        name="zip"
        placeholder="ZIP"
        inputMode="numeric"
        autoComplete="postal-code"
        className="leadform-input"
      />
      <textarea
        name="message"
        placeholder="What do you need?"
        rows={3}
        className="leadform-input leadform-textarea"
      />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="leadform-honeypot"
      />
      {error && <p className="leadform-error">{error}</p>}
      <button type="submit" disabled={pending} className="leadform-submit">
        {pending ? 'Sending…' : submit}
      </button>
    </form>
  );
}
