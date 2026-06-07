import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref } from '../../lib/content';
import { VideoEmbed } from '../shared/VideoEmbed';
import { LongformSection } from '../shared/LongformSection';
import {
  deriveAreas,
  areaSlugByTitle,
  deriveFaqs,
  deriveBlogTeasers,
  firstReview,
} from '../../lib/variant-utils';
import { Phone } from '../icons/Phone';
import { Check } from '../icons/Check';
import { ScrollReveal } from '../motion/ScrollReveal';
import { LeadForm } from '../shared/LeadForm';
import { LocalBusinessJsonLd, FaqJsonLd } from '../shared/LocalBusinessJsonLd';
import { VideoObjectJsonLd } from '../shared/VideoObjectJsonLd';
import { MapEmbed } from '../shared/MapEmbed';
import { SiteNav } from '../shared/SiteNav';
import { SiteNavigationJsonLd } from '../shared/SiteNavigationJsonLd';
import { TrustStrip } from '../shared/TrustStrip';
import { CertificationsRow } from '../shared/CertificationsRow';
import { ReviewsSection } from '../shared/ReviewsSection';
import { PhotoGallery } from '../shared/PhotoGallery';
import { GuaranteesList } from '../shared/GuaranteesList';
import { CallNowBadge } from '../shared/CallNowBadge';

interface Props {
  bundle: Bundle;
  /** Tracking number resolved by the catch-all server component (Postgres). */
  phone: string;
  /** Postgres sites.id — passed through to LeadForm for attribution. */
  siteId: string;
  /** Optional secondary slug — passed through to LeadForm. */
  siteSlug?: string;
  /** Absolute URL of the page, used for canonical + JSON-LD. */
  pageUrl?: string;
}

/**
 * Variant E — Haul.
 * Blue-collar junk-removal / hauling / demolition template.
 * For junk removal, dumpster rental, demo, moving help, cleanouts.
 *
 * Type: Archivo Black display (heavy, uppercase) + Inter body.
 * Color: Ink #0E2A1C deep forest + Paper #FBF8F1 cream + Accent #1FB76D safety green.
 * Shape: 8px card radius, 6px button radius, 2px chunky borders, 6px green offset shadow.
 * Voice: imperative, phone-first. "We do all the lifting." "Tap to call."
 */
export function HaulHome({
  bundle,
  phone,
  siteId,
  siteSlug,
  pageUrl = 'https://example.com',
}: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');

  // Haul-specific trust signal fallbacks (blue-collar, action-oriented)
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Same-day pickup', 'Upfront pricing', 'We do all the lifting', 'Eco disposal'];

  // Emoji icon set for services — cycles by index if more/fewer than 6
  const serviceEmojis = ['🛋️', '🧹', '🏠', '🔧', '🌿', '🏗️', '📦', '🚛', '🪑', '🔩'];

  // Service one-liners for the grid (use meta_description or title)
  const derived = {
    areas: deriveAreas(bundle),
    slugByTitle: areaSlugByTitle(bundle),
    faqs: deriveFaqs(bundle),
    blogTeasers: deriveBlogTeasers(bundle),
    review: firstReview(bundle),
  };

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={derived.faqs} />
      <SiteNavigationJsonLd bundle={bundle} baseUrl={baseUrl} />

      <div className="haul-shell">
        {/* ── Utility bar ── */}
        <div className="haul-utility">
          <div className="haul-utility-items">
            <span>⚡ {trust[0] ?? 'Same-day pickup'}</span>
            <span className="hidden sm:inline">♻ {trust[3] ?? 'Eco disposal'}</span>
            <span className="hidden md:inline">💰 {trust[1] ?? 'Upfront pricing'}</span>
            <span className="hidden lg:inline">📞 We always answer</span>
          </div>
          <a href={tel} className="haul-utility-phone">{phone}</a>
        </div>

        {/* ── Header ── */}
        <header className="haul-header">
          <a href="/" className="haul-brand">
            {bundle.logo_url ? (
              <Image
                src={bundle.logo_url}
                alt=""
                width={44}
                height={44}
                className="haul-brand-icon"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="haul-brand-icon" aria-hidden>🚛</div>
            )}
            <div>
              <div className="haul-brand-name">{bundle.business_name}</div>
              <div className="haul-brand-sub">
                Same-day hauling &middot; {bundle.city}, {bundle.state}
              </div>
            </div>
          </a>

          <a href={tel} className="haul-header-phone" aria-label={`Call ${phone}`}>
            <span className="haul-phone-pulse-icon" aria-hidden>📞</span>
            <span>
              <span className="haul-header-phone-label">Tap to call</span>
              <span className="haul-header-phone-num num">{phone}</span>
            </span>
          </a>
        </header>

        {/* ── Top nav ── */}
        <SiteNav bundle={bundle} variant="haul" showAllPages />

        {/* ── Hero — above fold, no ScrollReveal, no motion wrapper ── */}
        <section className="haul-hero" aria-labelledby="hero-h1">
          <div className="haul-hero-text">
            <div className="haul-eyebrow-pill">
              <span className="haul-eyebrow-dot" aria-hidden />
              {bundle.city}&rsquo;s #1 Haulers
            </div>
            {/* ADR 0002: H1 is the targeted keyword verbatim — CSS uppercases it. */}
            <h1 id="hero-h1" className="haul-h1">
              {heroH1(bundle)}
            </h1>
            <p className="haul-lede">{bundle.home.meta_description}</p>
            {bundle.response_time_promise && (
              <p className="haul-lede" style={{ fontWeight: 700, marginTop: 8 }}>
                {bundle.response_time_promise}
              </p>
            )}
            <div className="haul-hero-buttons">
              {/* Primary phone CTA */}
              <a href={tel} className="haul-phone-btn">
                <span className="haul-phone-btn-icon haul-phone-pulse-icon" aria-hidden>📞</span>
                <span>
                  <span className="haul-phone-btn-label">Tap to call</span>
                  <span className="haul-phone-btn-num num">{phone}</span>
                </span>
              </a>
              <a href="#contact" className="haul-btn-outline">Get a Free Quote &rarr;</a>
            </div>
            <CallNowBadge bundle={bundle} />
            <ul className="haul-hero-trust">
              {trust.slice(0, 4).map((t) => (
                <li key={t}>
                  <span className="haul-check-badge" aria-hidden>&#10003;</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Hero visual: photo or inline SVG truck illustration */}
          <div className="haul-hero-visual">
            {bundle.hero_image_url ? (
              <Image
                src={bundle.hero_image_url}
                alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 768px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              /* Inline SVG illustration — the Haul brand signature. aria-hidden: decorative. */
              <div className="haul-truck-wrap">
                <svg
                  className="haul-truck-svg"
                  viewBox="0 0 600 420"
                  preserveAspectRatio="xMidYMid slice"
                  style={{ width: '100%', height: '100%', display: 'block' }}
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <linearGradient id="haulSky" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1c3a2a" />
                      <stop offset="60%" stopColor="#0e2a1c" />
                      <stop offset="100%" stopColor="#0a1f15" />
                    </linearGradient>
                    <linearGradient id="haulGround" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0a1f15" />
                      <stop offset="100%" stopColor="#061812" />
                    </linearGradient>
                    <radialGradient id="haulSun" cx="0.78" cy="0.32" r="0.18">
                      <stop offset="0%" stopColor="#1FB76D" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#1FB76D" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect width="600" height="420" fill="url(#haulSky)" />
                  <rect y="300" width="600" height="120" fill="url(#haulGround)" />
                  {/* sun glow */}
                  <circle cx="468" cy="135" r="42" fill="#1FB76D" />
                  <rect width="600" height="420" fill="url(#haulSun)" />
                  {/* horizon dashed line */}
                  <line x1="0" y1="300" x2="600" y2="300" stroke="#1FB76D" strokeWidth="1" strokeDasharray="6 6" opacity="0.4" />
                  {/* truck body */}
                  <g transform="translate(80 168)">
                    {/* dump bed */}
                    <path d="M 0 0 L 260 0 L 260 110 L 0 110 Z" fill="#FBF8F1" stroke="#0E2A1C" strokeWidth="3" />
                    {/* bed ribs */}
                    <line x1="40" y1="8" x2="40" y2="102" stroke="#0E2A1C" strokeWidth="2" />
                    <line x1="90" y1="8" x2="90" y2="102" stroke="#0E2A1C" strokeWidth="2" />
                    <line x1="140" y1="8" x2="140" y2="102" stroke="#0E2A1C" strokeWidth="2" />
                    <line x1="190" y1="8" x2="190" y2="102" stroke="#0E2A1C" strokeWidth="2" />
                    {/* cab */}
                    <path d="M 260 25 L 330 25 L 360 60 L 360 110 L 260 110 Z" fill="#1FB76D" stroke="#0E2A1C" strokeWidth="3" />
                    {/* cab window */}
                    <path d="M 270 38 L 318 38 L 340 64 L 270 64 Z" fill="#0E2A1C" />
                    {/* door handle */}
                    <line x1="275" y1="78" x2="285" y2="78" stroke="#0E2A1C" strokeWidth="3" strokeLinecap="round" />
                    {/* wheels */}
                    <circle cx="55" cy="120" r="22" fill="#0E2A1C" stroke="#FBF8F1" strokeWidth="3" />
                    <circle cx="55" cy="120" r="8" fill="#FBF8F1" />
                    <circle cx="290" cy="120" r="22" fill="#0E2A1C" stroke="#FBF8F1" strokeWidth="3" />
                    <circle cx="290" cy="120" r="8" fill="#FBF8F1" />
                    {/* load — crates */}
                    <rect x="20" y="-32" width="50" height="32" fill="#D3F1DF" stroke="#0E2A1C" strokeWidth="2" />
                    <rect x="76" y="-46" width="56" height="46" fill="#1FB76D" stroke="#0E2A1C" strokeWidth="2" />
                    <rect x="138" y="-26" width="40" height="26" fill="#D3F1DF" stroke="#0E2A1C" strokeWidth="2" />
                    {/* chair on top */}
                    <path d="M 190 -8 L 190 -50 L 230 -50 L 230 -8 L 222 -8 L 222 -38 L 198 -38 L 198 -8 Z" fill="#FBF8F1" stroke="#0E2A1C" strokeWidth="2" />
                    <rect x="184" y="-12" width="52" height="6" fill="#FBF8F1" stroke="#0E2A1C" strokeWidth="2" />
                  </g>
                  {/* curb boxes */}
                  <g transform="translate(420 280)">
                    <rect x="0" y="0" width="42" height="34" fill="#FBF8F1" stroke="#0E2A1C" strokeWidth="2" />
                    <rect x="44" y="-14" width="48" height="48" fill="#1FB76D" stroke="#0E2A1C" strokeWidth="2" />
                    <line x1="44" y1="10" x2="92" y2="10" stroke="#0E2A1C" strokeWidth="2" />
                    <rect x="94" y="6" width="32" height="28" fill="#FBF8F1" stroke="#0E2A1C" strokeWidth="2" />
                  </g>
                  {/* motion lines */}
                  <g opacity="0.5">
                    <line x1="20" y1="220" x2="60" y2="220" stroke="#1FB76D" strokeWidth="2" strokeLinecap="round" />
                    <line x1="10" y1="250" x2="55" y2="250" stroke="#1FB76D" strokeWidth="2" strokeLinecap="round" />
                    <line x1="30" y1="275" x2="65" y2="275" stroke="#1FB76D" strokeWidth="2" strokeLinecap="round" />
                  </g>
                </svg>
              </div>
            )}
            <div className="haul-hero-badge" aria-hidden>⚡ Same-Day Pickup</div>
          </div>
        </section>

        {/* video under hero (manual) + keyword-rich long-form intro */}
        <VideoObjectJsonLd bundle={bundle} url={pageUrl} />
        <VideoEmbed
          url={bundle.video_url}
          description={bundle.video_description}
          className="ll-video haul-video"
        />
        <LongformSection
          body={bundle.longform_body}
          phone={phone}
          className="ll-longform haul-longform"
        />

        {/* ── Trust strip (dark) — right under hero, no ScrollReveal ── */}
        <TrustStrip bundle={bundle} variant="haul" />

        {/* ── Inline trust cells (Haul's own design pattern) ── */}
        <div className="haul-trust-strip surface-inverse" aria-label="Why choose us">
          {[
            { icon: '⚡', title: trust[0] ?? 'Same-day service', sub: 'Most jobs same or next day' },
            { icon: '💰', title: trust[1] ?? 'Upfront pricing', sub: 'No hidden fees. Ever.' },
            { icon: '💪', title: trust[2] ?? 'We do the lifting', sub: 'You point, we haul.' },
            { icon: '♻️', title: trust[3] ?? 'Eco disposal', sub: 'Recycle + donate when we can' },
          ].map(({ icon, title, sub }) => (
            <div key={title} className="haul-trust-cell">
              <div className="haul-trust-icon" aria-hidden>{icon}</div>
              <div>
                <div className="haul-trust-title">{title}</div>
                <div className="haul-trust-sub">{sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Proof strip — first real review, plain text, no review schema ── */}
        {derived.review && (
          <div className="haul-proof-strip">
            <blockquote className="haul-proof-quote">
              &ldquo;{derived.review.text}&rdquo;
            </blockquote>
            <cite className="haul-proof-author">&mdash; {derived.review.author}</cite>
          </div>
        )}

        {/* ── Certifications ── */}
        <CertificationsRow bundle={bundle} variant="haul" />

        {/* ── Mid-page phone CTA block ── */}
        <section className="haul-cta-band" aria-label="Call us">
          <p className="haul-section-eyebrow">We answer every call</p>
          <a href={tel} className="haul-phone-btn" style={{ display: 'inline-flex', marginTop: 14 }}>
            <span className="haul-phone-btn-icon haul-phone-pulse-icon" aria-hidden>📞</span>
            <span>
              <span className="haul-phone-btn-label">Tap to call</span>
              <span className="haul-phone-btn-num num">{phone}</span>
            </span>
          </a>
          <CallNowBadge bundle={bundle} />
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.875rem', marginTop: 8, color: 'var(--ink-2)' }}>
            <Phone width={14} height={14} style={{ verticalAlign: 'middle' }} />
            {' '}Free estimates &middot; Same-day &middot; No hidden fees
          </p>
        </section>

        {/* ── Services ── */}
        <ScrollReveal as="section" className="haul-services" id="services">
          <div className="haul-services-head">
            <div>
              <p className="haul-section-eyebrow">What we remove</p>
              <h2 className="haul-h2">
                {bundle.niche} services<br />in {bundle.city}.
              </h2>
            </div>
            <p className="haul-services-sub">
              No job too big or too small. Single items to full property cleanouts
              across {bundle.city} and {bundle.state}.
            </p>
          </div>
          <div className="haul-services-grid">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={s.slug} className="haul-service-card">
                <div className="haul-service-icon-wrap" aria-hidden>
                  {serviceEmojis[i % serviceEmojis.length]}
                </div>
                <h3 className="haul-service-title">{s.title}</h3>
                <p className="haul-service-blurb">{s.meta_description}</p>
                <span className="haul-service-cta">Get pricing &rarr;</span>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* ── Photo gallery ── */}
        <PhotoGallery bundle={bundle} variant="haul" />

        {/* ── How it works (dark band) ── */}
        <ScrollReveal as="section" className="haul-how surface-inverse" aria-label="How it works">
          <div className="haul-how-head">
            <p className="haul-section-eyebrow">Simple process</p>
            <h2 className="haul-h2">How junk removal works.</h2>
          </div>
          <div className="haul-how-steps">
            {[
              {
                title: 'Call or book online',
                body: `Call ${phone} or fill out our quote form. Free estimate right away — usually in under 60 seconds.`,
              },
              {
                title: 'We show up',
                body: `Our crew arrives on time at your ${bundle.city} home or business. You point, we haul. No lifting required on your end.`,
              },
              {
                title: 'Junk is gone',
                body: 'We load everything, clean up after ourselves, and haul it away. Eco-friendly disposal and donation whenever possible.',
              },
            ].map(({ title, body }, i) => (
              <div key={title} className="haul-how-step">
                <div className="haul-how-step-num" aria-hidden>{i + 1}</div>
                <div>
                  <h3 className="haul-how-step-title">{title}</h3>
                  <p className="haul-how-step-body">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* ── Bottom CTA + service areas grid ── */}
        <ScrollReveal as="div" className="haul-cta-row">
          {/* CTA panel (accent bg) */}
          <div className="haul-cta-band">
            <h2 className="haul-cta-h2">
              Ready to clear<br />the clutter?
            </h2>
            <p className="haul-cta-sub">
              Call now or request a free quote online. Same-day service available
              throughout {bundle.city}, {bundle.state}.
            </p>
            <div className="haul-cta-buttons">
              <a href={tel} className="haul-phone-btn haul-phone-btn-dark">
                <span className="haul-phone-btn-icon haul-phone-pulse-icon" aria-hidden>📞</span>
                <span>
                  <span className="haul-phone-btn-label">Tap to call</span>
                  <span className="haul-phone-btn-num num">{phone}</span>
                </span>
              </a>
              <a href="#contact" className="haul-btn-outline">Free Quote &rarr;</a>
            </div>
          </div>

          {/* Areas panel */}
          <div className="haul-areas-panel">
            <p className="haul-areas-eyebrow">Where we serve</p>
            <h3 className="haul-areas-h3">{bundle.city} &amp; surrounding areas</h3>
            <p className="haul-areas-list">
              {derived.areas.join(' · ')}
            </p>
            {bundle.nearby_cities.length > 0 && (
              <ul className="haul-zip-chips">
                {bundle.nearby_cities.slice(0, 6).map((c) => (
                  <li key={c} className="haul-zip-chip">{c}</li>
                ))}
              </ul>
            )}
          </div>
        </ScrollReveal>

        {/* ── Service area chips + map ── */}
        <ScrollReveal as="section" className="haul-areas-section" id="where">
          <p className="haul-section-eyebrow">Right in your backyard</p>
          <h2 className="haul-h2">{bundle.city} &amp; nearby towns</h2>
          <ul className="haul-area-chips">
            {derived.areas.map((c) => {
              const slug = derived.slugByTitle.get(c);
              return (
                <li key={c}>
                  {slug ? <a href={slug}>{c}</a> : c}
                </li>
              );
            })}
          </ul>
          {bundle.neighborhoods.length > 0 && (
            <ul className="haul-area-chips" style={{ marginTop: 12 }} aria-label="Neighborhoods">
              {bundle.neighborhoods.map((n) => (
                <li key={n.name}>
                  <a href={n.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                    {n.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <MapEmbed
            className="haul-map-frame"
            city={bundle.city}
            state={bundle.state}
            height={300}
          />
        </ScrollReveal>

        {/* ── Guarantees ── */}
        <GuaranteesList bundle={bundle} />

        {/* ── FAQ ── */}
        {derived.faqs.length > 0 && (
          <ScrollReveal as="section" className="haul-faq" aria-label="FAQ">
            <p className="haul-section-eyebrow">Good question</p>
            <h2 className="haul-h2">Common questions about {bundle.niche}.</h2>
            <dl className="haul-faq-list">
              {derived.faqs.map((f, i) => (
                <details key={i} className="haul-faq-item" open={i === 0}>
                  <summary>
                    <dt>{f.q}</dt>
                  </summary>
                  <dd>{f.a}</dd>
                </details>
              ))}
            </dl>
          </ScrollReveal>
        )}

        {/* ── Info pages / local guides ── */}
        {bundle.info_pages.length > 0 && (
          <ScrollReveal as="section" className="haul-learn" aria-label="Resources">
            <p className="haul-section-eyebrow">Good reads</p>
            <h2 className="haul-h2">Local guides &amp; info</h2>
            <ul className="haul-learn-list">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="haul-learn-title">{p.title}</span>
                    <span className="haul-learn-arrow">&rarr;</span>
                    <span className="haul-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {/* ── Blog teasers ── */}
        {derived.blogTeasers.length > 0 && (
          <ScrollReveal as="section" className="haul-learn" aria-label="From the blog">
            <p className="haul-section-eyebrow">From our crew</p>
            <h2 className="haul-h2">Recent articles</h2>
            <ul className="haul-learn-list">
              {derived.blogTeasers.map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="haul-learn-title">{p.title}</span>
                    <span className="haul-learn-arrow">&rarr;</span>
                    <span className="haul-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {/* ── Reviews ── */}
        <ReviewsSection bundle={bundle} variant="haul" />

        {/* ── Contact + form ── */}
        <ScrollReveal as="section" className="haul-contact" id="contact">
          <div className="haul-contact-info surface-inverse">
            <p className="haul-section-eyebrow" style={{ color: 'var(--surface-inverse-accent-fg)' }}>
              Ready to help
            </p>
            <h2 className="haul-h2" style={{ color: 'var(--surface-inverse-fg)' }}>
              Call us &mdash; we pick up.
            </h2>
            <a href={tel} className="haul-contact-phone-link num">
              <Phone width={22} height={22} />
              {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <p>Open 7 days a week &middot; Free quotes</p>
            <p className="haul-contact-areas">
              Serving {derived.areas.slice(0, 6).join(' · ')}
            </p>
          </div>
          <div className="haul-contact-form">
            <LeadForm
              variant="haul"
              heading="Get a free, no-obligation quote"
              sub="Or just call — we always pick up."
              submit="SEND &rarr;"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </ScrollReveal>

        {/* ── Footer ── */}
        <footer className="haul-footer surface-inverse">
          <div className="haul-footer-grid">
            <div>
              <div className="haul-footer-brand">
                <div className="haul-footer-brand-icon" aria-hidden>🚛</div>
                <div className="haul-footer-brand-name">{bundle.business_name}</div>
              </div>
              <p className="haul-footer-blurb">
                {bundle.city}&rsquo;s trusted {bundle.niche.toLowerCase()} service.
                We haul furniture, appliances, yard waste, and more throughout {bundle.state}.
              </p>
            </div>
            <div className="haul-footer-col">
              <div className="haul-footer-col-heading">Services</div>
              <ul>
                {bundle.services.slice(0, 5).map((s) => (
                  <li key={s.slug}><a href={s.slug} style={{ color: 'inherit', textDecoration: 'none' }}>{s.title}</a></li>
                ))}
              </ul>
            </div>
            <div className="haul-footer-col">
              <div className="haul-footer-col-heading">Company</div>
              <ul>
                <li><a href="/about" style={{ color: 'inherit', textDecoration: 'none' }}>About</a></li>
                <li><a href="/contact" style={{ color: 'inherit', textDecoration: 'none' }}>Contact</a></li>
                {bundle.service_areas.slice(0, 3).map((a) => (
                  <li key={a.slug}><a href={a.slug} style={{ color: 'inherit', textDecoration: 'none' }}>{a.title}</a></li>
                ))}
              </ul>
            </div>
            <div className="haul-footer-col">
              <div className="haul-footer-col-heading">Contact</div>
              <ul>
                <li><a href={tel} style={{ color: 'inherit', textDecoration: 'none' }}>{phone}</a></li>
                <li>{bundle.city}, {bundle.state}</li>
                <li>Open 7 days</li>
                {bundle.license_number && <li>Lic. #{bundle.license_number}</li>}
              </ul>
            </div>
          </div>
          <div className="haul-footer-bottom">
            <span>
              &copy; {new Date().getFullYear()} {bundle.business_name}.
              {bundle.license_number ? ` Licensed #${bundle.license_number}.` : ''}
              {' '}All rights reserved.
            </span>
            <span>Serving {bundle.city}, {bundle.state}</span>
          </div>
        </footer>

        {/* ── Sticky mobile bar ── */}
        <div className="sticky-mobile-bar surface-inverse" aria-hidden="false">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            <Phone width={16} height={16} />
            {phone}
          </a>
          <a href="#contact" className="cta">Free quote</a>
        </div>
        <div className="haul-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}
