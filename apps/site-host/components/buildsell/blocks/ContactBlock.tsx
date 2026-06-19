'use client';

import { useState } from 'react';
import type { BuildSellSection } from '@/lib/sanity';

interface ContactBlockProps {
  section: BuildSellSection;
  buildsellSiteId: string;
  phone?: string | null;
}

export function ContactBlock({ section, buildsellSiteId, phone }: ContactBlockProps) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const addr = section.address;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('submitting');

    const fd = new FormData(e.currentTarget);
    const honeypot = fd.get('website') as string | null;
    if (honeypot && honeypot.trim().length > 0) {
      // Honeypot triggered — silently succeed
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
      if (res.ok) {
        setStatus('done');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="bs-section bs-section-dark" id="contact">
      <div className="bs-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: addr ? '1fr 1fr' : '1fr',
            gap: 'clamp(2rem, 5vw, 5rem)',
            alignItems: 'start',
          }}
        >
          {/* Info side */}
          <div>
            <h2
              className="bs-section-title"
              style={{ color: 'var(--bs-on-primary)' }}
            >
              {section.heading ?? 'Get in Touch'}
            </h2>
            {section.subhead && (
              <p
                className="bs-section-intro"
                style={{ color: 'color-mix(in srgb, var(--bs-on-primary) 75%, transparent)' }}
              >
                {section.subhead}
              </p>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="bs-btn bs-btn-ghost bs-btn-lg"
                style={{ display: 'inline-flex', marginBottom: '1.5rem' }}
              >
                {phone}
              </a>
            )}
            {addr && (
              <address
                style={{
                  fontStyle: 'normal',
                  color: 'color-mix(in srgb, var(--bs-on-primary) 80%, transparent)',
                  lineHeight: 1.7,
                  fontSize: '0.95rem',
                }}
              >
                {addr.street && <div>{addr.street}</div>}
                {(addr.city || addr.state || addr.zip) && (
                  <div>
                    {[addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}
                  </div>
                )}
                {addr.hours && <div style={{ marginTop: '0.5rem' }}>{addr.hours}</div>}
                {addr.serviceArea && (
                  <div style={{ marginTop: '0.5rem' }}>
                    Serving: {addr.serviceArea}
                  </div>
                )}
              </address>
            )}
          </div>

          {/* Form side */}
          <div
            style={{
              background: 'var(--bs-surface)',
              borderRadius: 'var(--bs-radius-card)',
              padding: 'clamp(1.25rem, 4vw, 2rem)',
              boxShadow: 'var(--bs-shadow-lg)',
            }}
          >
            {status === 'done' ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }} aria-hidden="true">
                  ✓
                </div>
                <p
                  style={{
                    fontFamily: 'var(--bs-font-heading)',
                    fontWeight: 700,
                    fontSize: '1.2rem',
                    color: 'var(--bs-text)',
                    margin: '0 0 0.5rem',
                  }}
                >
                  Thanks! We&apos;ll be in touch soon.
                </p>
                <p style={{ color: 'var(--bs-muted)', fontSize: '0.9rem', margin: 0 }}>
                  Expect a call or email within 24 hours.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bs-form" noValidate>
                {/* Honeypot — hidden from humans */}
                <div className="bs-honeypot" aria-hidden="true">
                  <label htmlFor="bs-website">Website</label>
                  <input type="text" id="bs-website" name="website" tabIndex={-1} autoComplete="off" />
                </div>

                <div className="bs-form-row">
                  <div className="bs-form-field">
                    <label htmlFor="bs-name">Name</label>
                    <input
                      id="bs-name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      placeholder="Jane Smith"
                    />
                  </div>
                  <div className="bs-form-field">
                    <label htmlFor="bs-phone">Phone *</label>
                    <input
                      id="bs-phone"
                      name="phone"
                      type="tel"
                      required
                      autoComplete="tel"
                      placeholder="(555) 000-0000"
                    />
                  </div>
                </div>

                <div className="bs-form-field">
                  <label htmlFor="bs-email">Email</label>
                  <input
                    id="bs-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="jane@example.com"
                  />
                </div>

                <div className="bs-form-field">
                  <label htmlFor="bs-message">Message</label>
                  <textarea
                    id="bs-message"
                    name="message"
                    placeholder="Describe your project..."
                  />
                </div>

                {status === 'error' && (
                  <p
                    role="alert"
                    style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}
                  >
                    Something went wrong. Please try again or call us directly.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="bs-btn bs-btn-primary bs-btn-lg"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {status === 'submitting' ? 'Sending...' : 'Get a Free Quote'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
