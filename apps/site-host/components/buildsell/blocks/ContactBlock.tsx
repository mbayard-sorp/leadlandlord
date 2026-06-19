'use client';

import { useState } from 'react';
import type { BuildSellSection } from '@/lib/sanity';

interface ContactBlockProps {
  section: BuildSellSection;
  buildsellSiteId: string;
  phone?: string | null;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * Contact block layout per variant:
 * - split:  info left, form right (standard)
 * - bold:   form left, info right (panel order swapped)
 * - trust:  dark panel wraps the info side; form sits in a light card
 *
 * The form itself is identical across all variants — only the panel
 * arrangement and background treatment change.
 */
export function ContactBlock({ section, buildsellSiteId, phone, layoutVariant }: ContactBlockProps) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const addr = section.address;
  const isTrust = layoutVariant === 'trust';
  const isBold = layoutVariant === 'bold';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('submitting');

    const fd = new FormData(e.currentTarget);
    const honeypot = fd.get('website') as string | null;
    if (honeypot && honeypot.trim().length > 0) {
      setStatus('done');
      return;
    }

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_OPERATOR_URL ?? 'https://app.leadslandlord.com'}/api/bs/lead`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            buildsell_site_id: buildsellSiteId,
            name: fd.get('name'),
            phone: fd.get('phone'),
            email: fd.get('email'),
            message: fd.get('message'),
            website: fd.get('website'),
          }),
        },
      );
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  function InfoPanel() {
    return (
      <div className={`bs-contact-info${isTrust ? ' bs-contact-info--dark' : ''}`}>
        <h2
          className="bs-section-title"
          style={{ color: isTrust ? 'var(--bs-on-primary)' : undefined }}
        >
          {section.heading ?? 'Get in Touch'}
        </h2>
        {section.subhead && (
          <p
            className="bs-section-intro"
            style={{
              color: isTrust
                ? 'color-mix(in srgb, var(--bs-on-primary) 75%, transparent)'
                : undefined,
            }}
          >
            {section.subhead}
          </p>
        )}
        {phone && (
          <a
            href={`tel:${phone}`}
            className="bs-btn bs-btn-lg bs-contact-phone-btn"
            style={isTrust
              ? { color: 'var(--bs-on-primary)', borderColor: 'color-mix(in srgb, var(--bs-on-primary) 50%, transparent)' }
              : undefined}
          >
            {phone}
          </a>
        )}
        {addr && (
          <address className="bs-contact-address" style={isTrust ? { color: 'color-mix(in srgb, var(--bs-on-primary) 80%, transparent)' } : undefined}>
            {addr.street && <div>{addr.street}</div>}
            {(addr.city || addr.state || addr.zip) && (
              <div>{[addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}</div>
            )}
            {addr.hours && <div className="bs-contact-hours">{addr.hours}</div>}
            {addr.serviceArea && (
              <div className="bs-contact-service-area">Serving: {addr.serviceArea}</div>
            )}
          </address>
        )}
      </div>
    );
  }

  function FormPanel() {
    return (
      <div className="bs-contact-form-panel">
        {status === 'done' ? (
          <div className="bs-contact-success">
            <div className="bs-contact-success-icon" aria-hidden="true">✓</div>
            <p className="bs-contact-success-title">Thanks! We&apos;ll be in touch soon.</p>
            <p className="bs-contact-success-sub">Expect a call or email within 24 hours.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bs-form" noValidate>
            {/* Honeypot */}
            <div className="bs-honeypot" aria-hidden="true">
              <label htmlFor="bs-website">Website</label>
              <input type="text" id="bs-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <div className="bs-form-row">
              <div className="bs-form-field">
                <label htmlFor="bs-name">Name</label>
                <input id="bs-name" name="name" type="text" autoComplete="name" placeholder="Jane Smith" />
              </div>
              <div className="bs-form-field">
                <label htmlFor="bs-phone">Phone *</label>
                <input id="bs-phone" name="phone" type="tel" required autoComplete="tel" placeholder="(555) 000-0000" />
              </div>
            </div>

            <div className="bs-form-field">
              <label htmlFor="bs-email">Email</label>
              <input id="bs-email" name="email" type="email" autoComplete="email" placeholder="jane@example.com" />
            </div>

            <div className="bs-form-field">
              <label htmlFor="bs-message">Message</label>
              <textarea id="bs-message" name="message" placeholder="Describe your project..." />
            </div>

            {status === 'error' && (
              <p role="alert" className="bs-form-error">
                Something went wrong. Please try again or call us directly.
              </p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="bs-btn bs-btn-primary bs-btn-lg bs-form-submit"
            >
              {status === 'submitting' ? 'Sending...' : 'Get a Free Quote'}
            </button>
          </form>
        )}
      </div>
    );
  }

  // trust: dark section wrapper; form is the light card inside
  if (isTrust) {
    return (
      <section className="bs-section bs-section-dark bs-reveal" id="contact">
        <div className="bs-container">
          <div className="bs-contact-grid bs-contact-grid--trust">
            <InfoPanel />
            <FormPanel />
          </div>
        </div>
      </section>
    );
  }

  // bold: form left, info right
  if (isBold) {
    return (
      <section className="bs-section bs-section-dark bs-reveal" id="contact">
        <div className="bs-container">
          <div className="bs-contact-grid bs-contact-grid--bold">
            <FormPanel />
            <InfoPanel />
          </div>
        </div>
      </section>
    );
  }

  // split (default): info left, form right
  return (
    <section className="bs-section bs-section-dark bs-reveal" id="contact">
      <div className="bs-container">
        <div className="bs-contact-grid">
          <InfoPanel />
          <FormPanel />
        </div>
      </div>
    </section>
  );
}
