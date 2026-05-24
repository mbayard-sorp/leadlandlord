'use client';

import { useState } from 'react';

interface Props {
  /** Visual variant — controls input/button styling via CSS classes. */
  variant: 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';
  /** Optional headline ("Get a free quote"). */
  heading?: string;
  /** Optional subhead ("Reply same business day"). */
  sub?: string;
  /** Submit-button label. */
  submit?: string;
  /** Source page key — sent with the submission so /api/lead can route by site. */
  source?: string;
  /** Postgres sites.id for the current site. Sent with the submission so /api/lead attributes the lead. */
  siteId: string;
  /** Optional secondary slug (e.g. niche-city). Used as a backup attribution path. */
  siteSlug?: string;
}

/**
 * The 4-field lead form per shared rule §01.
 *
 *   name · phone (required) · zip · message
 *   honeypot field (anti-bot)
 *   posts to /api/lead → email + Klaviyo (when integration lands)
 */
export function LeadForm({ variant, heading, sub, submit = 'Send →', source = 'home', siteId, siteSlug }: Props) {
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
      // Same-origin POST: site-host's /api/lead is a thin proxy that forwards
      // to the operator app's /api/lead, preserving the existing JSON contract.
      // siteId/siteSlug come from the parent server component (resolved from Sanity).
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          site_slug: siteSlug,
          name: fd.get('name'),
          phone: fd.get('phone'),
          email: fd.get('email'),
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
