'use client';

import { useState } from 'react';
import type { BuildSellSection } from '@/lib/sanity';
import { Icon } from '../Icon';
import { SendIcon } from '../bs-svg';

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

  const showDetails = section.showDetails ?? true;
  const showMap = section.showMap ?? false;
  const labels = section.formLabels ?? {};

  // Resolve the lead endpoint: a relative path is prefixed with the operator URL.
  const operatorBase = process.env.NEXT_PUBLIC_OPERATOR_URL ?? 'https://leadlandlord-operator.vercel.app';
  const endpoint = section.formEndpoint?.trim() || '/api/bs/lead';
  const postUrl = endpoint.startsWith('http') ? endpoint : `${operatorBase}${endpoint}`;

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
      const res = await fetch(postUrl, {
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
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  function DetailRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
    return (
      <div className="bs-contact-detail">
        <span className="bs-contact-detail-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <div className="bs-contact-detail-body">
          <span className="bs-contact-detail-label">{label}</span>
          <div className="bs-contact-detail-value">{children}</div>
        </div>
      </div>
    );
  }

  function InfoPanel() {
    const cityLine = addr && (addr.city || addr.state || addr.zip)
      ? [addr.city, addr.state, addr.zip].filter(Boolean).join(', ')
      : null;
    return (
      <div className="bs-contact-info bs-contact-info--dark">
        <h2 className="bs-section-title">{section.heading ?? 'Get in Touch'}</h2>
        {section.subhead && (
          <p className="bs-section-intro">{section.subhead}</p>
        )}

        {showDetails && (
          <div className="bs-contact-details">
            {phone && (
              <DetailRow icon="phone" label="Call us">
                <a href={`tel:${phone}`} className="bs-contact-detail-link">{phone}</a>
              </DetailRow>
            )}
            {(addr?.street || cityLine) && (
              <DetailRow icon="map-pin" label="Visit">
                {addr?.street && <div>{addr.street}</div>}
                {cityLine && <div>{cityLine}</div>}
              </DetailRow>
            )}
            {addr?.hours && (
              <DetailRow icon="clock" label="Hours">{addr.hours}</DetailRow>
            )}
            {addr?.serviceArea && (
              <DetailRow icon="map" label="Service area">{addr.serviceArea}</DetailRow>
            )}
          </div>
        )}

        {showMap && (
          <div className="bs-contact-map" aria-hidden="true">
            <Icon name="map-pinned" size={26} />
            <span className="bs-contact-map-label">
              {addr?.serviceArea ? `Serving ${addr.serviceArea}` : 'Our service area'}
            </span>
          </div>
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
                <label htmlFor="bs-name">{labels.name ?? 'Name'}</label>
                <input id="bs-name" name="name" type="text" autoComplete="name" placeholder="Jane Smith" />
              </div>
              <div className="bs-form-field">
                <label htmlFor="bs-phone">{labels.phone ?? 'Phone *'}</label>
                <input id="bs-phone" name="phone" type="tel" required autoComplete="tel" placeholder="(555) 000-0000" />
              </div>
            </div>

            <div className="bs-form-field">
              <label htmlFor="bs-email">{labels.email ?? 'Email'}</label>
              <input id="bs-email" name="email" type="email" autoComplete="email" placeholder="jane@example.com" />
            </div>

            <div className="bs-form-field">
              <label htmlFor="bs-message">{labels.message ?? 'Message'}</label>
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
              {status === 'submitting' ? 'Sending...' : (labels.submit ?? 'Get a Free Quote')}
              {status !== 'submitting' && <SendIcon />}
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
