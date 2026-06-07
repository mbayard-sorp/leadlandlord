import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref } from '../../lib/content';
import { deriveAreas, areaSlugByTitle, deriveFaqs, firstReview } from '../../lib/variant-utils';
import { VideoEmbed } from '../shared/VideoEmbed';
import { LongformSection } from '../shared/LongformSection';
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
import { ReviewsSection } from '../shared/ReviewsSection';
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
 * Variant F — Counsel.
 * Small-town LEGAL LEAD-GEN. Family law, divorce, PI, bankruptcy, estate, DUI.
 *
 * LEAD-GEN CONSTRAINTS (read before editing):
 * - No named attorneys, no firm name, no attorney bios, no headshots.
 * - No fabricated reviews / ratings / case results (ADR 0012).
 * - Hero: inline SVG scales-of-justice illustration (civic, never a person).
 * - H1: heroH1(bundle) verbatim — exact targeted keyword (ADR 0002).
 * - Testimonial omitted entirely when reviews[] is empty (ADR 0012).
 * - Footer includes attorney-advertising / not-legal-advice disclaimer.
 *
 * Type: Source Serif 4 display + Inter body.
 * Color: Forest #1C3A2E + Brass (AA-safe #C09A52) on Cream #F7F3EA.
 */
export function CounselHome({ bundle, phone, siteId, siteSlug, pageUrl = 'https://example.com' }: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');

  // Derived data via shared helpers.
  const areas = deriveAreas(bundle);
  const slugByTitle = areaSlugByTitle(bundle);
  const faqs = deriveFaqs(bundle);
  const review = firstReview(bundle); // ADR 0012: null when no real reviews exist.

  // Legal trust signals — sourced from bundle; generic lawyer-appropriate fallbacks.
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : [
          `Member, ${bundle.state} State Bar`,
          'Available 24/7',
          'Strictly confidential',
          'Free consultation',
        ];

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={faqs} />
      <SiteNavigationJsonLd bundle={bundle} baseUrl={baseUrl} />

      <div className="counsel-shell">
        {/* Skip-nav target */}
        <a id="main" href="#counsel-main" className="sr-only focus:not-sr-only">
          Skip to main content
        </a>

        {/* Utility bar — dark forest, surface-inverse */}
        <div className="counsel-utility surface-inverse" aria-label="Quick contact">
          <div className="counsel-utility-left">
            <span>Available 24/7</span>
            <span className="counsel-utility-sep" aria-hidden>·</span>
            <span className="hidden sm:inline">Confidential</span>
          </div>
          <div className="counsel-utility-right">
            <span className="counsel-utility-accent">Free consultation</span>
            <span className="counsel-utility-sep hidden sm:inline" aria-hidden>·</span>
            <a href={tel} className="counsel-utility-phone num hidden sm:inline">
              {phone}
            </a>
          </div>
        </div>

        {/* Header */}
        <header className="counsel-header">
          <a href="/" className="counsel-brand" aria-label={`${bundle.business_name} home`}>
            {bundle.logo_url ? (
              <Image
                src={bundle.logo_url}
                alt=""
                width={44}
                height={44}
                className="counsel-logo"
              />
            ) : (
              <div className="counsel-mark" aria-hidden>
                <CounselScalesMark />
              </div>
            )}
            <div>
              <div className="counsel-brand-name">{bundle.business_name}</div>
              <div className="counsel-brand-tagline">
                Local Attorney &middot; {bundle.city}, {bundle.state}
              </div>
            </div>
          </a>
          <a href={tel} className="counsel-header-phone num" aria-label={`Call ${phone}`}>
            <Phone width={15} height={15} />
            <em>{phone}</em>
          </a>
        </header>

        {/* Top nav */}
        <SiteNav bundle={bundle} variant="counsel" showAllPages />

        {/* ── Hero — above fold, no ScrollReveal ── */}
        <section className="counsel-hero" aria-labelledby="hero-h1" id="counsel-main">
          {/* Left: scales illustration or hero image */}
          <div className="counsel-hero-visual">
            {bundle.hero_image_url ? (
              <Image
                src={bundle.hero_image_url}
                alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 900px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <CounselHeroIllustration />
            )}
          </div>

          {/* Right: H1 + CTAs */}
          <div className="counsel-hero-text">
            <CounselSectionMark roman="I" label={`${bundle.city} · ${bundle.state}`} />

            {/* ADR 0002: H1 = heroH1(bundle) verbatim. No word-split or restyle. */}
            <h1 id="hero-h1" className="counsel-h1">
              {heroH1(bundle)}
            </h1>

            <p className="counsel-hero-lede">
              {bundle.home.meta_description}{' '}
              <em>Free, confidential consultation</em> &mdash; most calls returned same business day.
            </p>

            <div className="counsel-hero-buttons">
              <a href="#contact" className="counsel-btn-primary">
                Request a Free Consultation &rarr;
              </a>
              <div className="counsel-btn-phone">
                <span className="counsel-btn-phone-label">Or call</span>
                <a href={tel} className="counsel-btn-phone-num num">{phone}</a>
              </div>
            </div>

            <ul className="counsel-hero-checks">
              {trust.slice(0, 4).map((t) => (
                <li key={t}>
                  <Check width={13} height={13} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* video under hero (manual) + keyword-rich long-form intro */}
        <VideoObjectJsonLd bundle={bundle} url={pageUrl} />
        <VideoEmbed
          url={bundle.video_url}
          description={bundle.video_description}
          className="ll-video counsel-video"
        />
        <LongformSection
          body={bundle.longform_body}
          phone={phone}
          className="ll-longform counsel-longform"
        />

        {/* Credentials bar */}
        <div className="counsel-creds" aria-label="Credentials">
          {trust.slice(0, 4).map((t, i, arr) => (
            <span key={t} className="counsel-creds-item">
              {t}
              {i < arr.length - 1 && (
                <span className="counsel-creds-sep" aria-hidden> &nbsp;◆&nbsp; </span>
              )}
            </span>
          ))}
          <span className="counsel-creds-sep" aria-hidden>◆</span>
          <em style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 'normal', fontSize: '0.9375rem' }}>
            No fee unless we win
          </em>
          <span style={{ fontSize: '0.625rem', color: 'var(--ink-3)' }}>(personal injury matters)</span>
        </div>

        {/* TrustStrip */}
        <TrustStrip bundle={bundle} variant="counsel" />

        {/* ── Practice Areas ── */}
        <ScrollReveal as="section" className="counsel-practice" id="practice" aria-label="Practice areas">
          <div className="counsel-practice-intro">
            <CounselSectionMark roman="II" label="How we help" />
            <h2 className="counsel-h2">
              Practice areas for{' '}
              <em className="counsel-h2-em">{bundle.city} families</em>{' '}
              &amp; small businesses.
            </h2>
            <p className="counsel-practice-sub">
              If your matter isn&rsquo;t listed, call anyway &mdash; we likely handle it or know a
              trusted local attorney who does.
            </p>
          </div>

          <div className="counsel-practice-grid" role="list">
            {bundle.services.map((s, i) => (
              <a
                key={s.slug}
                href={s.slug}
                className="counsel-practice-card"
                role="listitem"
              >
                <div className="counsel-practice-card-top">
                  <span className="counsel-practice-num">
                    {String(i + 1).padStart(2, '0')}.
                  </span>
                  <span className="counsel-practice-arrow" aria-hidden>&rarr;</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.meta_description}</p>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* ── What to expect — dark forest band ── */}
        <ScrollReveal
          as="section"
          className="counsel-expect surface-inverse"
          id="how-it-works"
          aria-label="What to expect from your first call"
        >
          <div className="counsel-expect-glow" aria-hidden />
          <div className="counsel-expect-header">
            <CounselSectionMark roman="III" label="What to expect" />
            <h2 className="counsel-h2">
              From your <em className="counsel-h2-em">first call</em>
              <br />to a local attorney.
            </h2>
            <CounselDivider />
          </div>
          <div className="counsel-expect-steps">
            {[
              {
                num: '01',
                title: 'Call or request a callback',
                body: 'Reach a real person — not an answering service — during business hours. After hours, leave a message; most calls are returned within a few hours.',
              },
              {
                num: '02',
                title: 'Free, confidential consultation',
                body: 'Tell your story. We listen, ask questions, and give you an honest read on whether you have a case and what to do next. No commitment.',
              },
              {
                num: '03',
                title: 'Decide together — no pressure',
                body: "If we can help, we explain fees and timeline before you sign anything. If we can't, we'll point you to someone local who can.",
              },
            ].map((step) => (
              <div key={step.num} className="counsel-expect-step">
                <div className="counsel-expect-step-num" aria-hidden>
                  {step.num}.
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* ── Testimonial — ADR 0012: rendered ONLY when a real review exists ── */}
        {review && (
          <ScrollReveal
            as="section"
            className="counsel-testimonial"
            aria-label="Client testimonial"
          >
            <div className="counsel-testimonial-inner">
              <p className="counsel-testimonial-eyebrow">
                <em>Client voice</em>
              </p>
              <blockquote>
                <span className="counsel-testimonial-mark" aria-hidden>
                  &ldquo;
                </span>
                {review.text}
              </blockquote>
              <p className="counsel-testimonial-attr">
                &mdash; {review.author}
                {review.source && `, via ${review.source}`}
              </p>
            </div>
          </ScrollReveal>
        )}

        {/* ReviewsSection (renders nothing internally when reviews is empty) */}
        <ReviewsSection bundle={bundle} variant="counsel" />

        {/* ── FAQ + Areas served — two-column ── */}
        {(faqs.length > 0 || areas.length > 0) && (
          <ScrollReveal as="div" className="counsel-faq-areas" id="faq">
            {/* FAQ column */}
            {faqs.length > 0 && (
              <section className="counsel-faq-col" aria-label="Frequently asked questions">
                <CounselSectionMark roman="IV" label="Common questions" />
                <h2 className="counsel-h2">Things people ask.</h2>
                <dl className="counsel-faq-list">
                  {faqs.map((f, i) => (
                    <details key={i} className="counsel-faq-item" open={i === 0}>
                      <summary>
                        <dt>{f.q}</dt>
                        <span className="counsel-faq-toggle" aria-hidden>
                          {i === 0 ? '−' : '+'}
                        </span>
                      </summary>
                      <dd>{f.a}</dd>
                    </details>
                  ))}
                </dl>
              </section>
            )}

            {/* Areas served column */}
            {areas.length > 0 && (
              <section className="counsel-areas-col" aria-label="Areas served">
                <CounselSectionMark roman="V" label="Areas served" />
                <h2 className="counsel-h2">
                  <em className="counsel-h2-em">{bundle.city}</em>{' '}
                  &amp; surrounding area.
                </h2>
                <div className="counsel-areas-list">
                  {areas.map((city, i) => {
                    const slug = slugByTitle.get(city);
                    return (
                      <span key={city}>
                        {slug ? <a href={slug}>{city}</a> : city}
                        {i < areas.length - 1 && (
                          <span aria-hidden> &middot; </span>
                        )}
                      </span>
                    );
                  })}
                </div>
                <p className="counsel-areas-note">
                  {bundle.state}-wide representation available for select matters.
                </p>
                <div className="counsel-map">
                  <MapEmbed
                    city={bundle.city}
                    state={bundle.state}
                    height={260}
                  />
                </div>
              </section>
            )}
          </ScrollReveal>
        )}

        {/* ── Bottom CTA — dark ink-deep band ── */}
        <ScrollReveal
          as="section"
          className="counsel-cta surface-inverse"
          id="contact"
          aria-label="Request a free consultation"
        >
          <div className="counsel-cta-glow" aria-hidden />
          <div className="counsel-cta-inner">
            <CounselSectionMark roman="VI" label="Talk to a local attorney" />
            <h2 className="counsel-h2">
              Get a{' '}
              <em className="counsel-h2-em">free consultation</em>
              <br />
              today.
            </h2>
            <CounselDivider />
            <p className="counsel-cta-sub">
              Free &middot; Confidential &middot; 30 minutes &middot; No pressure
            </p>
            <div className="counsel-cta-buttons">
              <a href="#contact-form" className="counsel-cta-btn-primary">
                Request a consultation &rarr;
              </a>
              <a href={tel} className="counsel-cta-btn-outline num" aria-label={`Call ${phone}`}>
                <Phone width={18} height={18} />
                {phone}
              </a>
            </div>
          </div>
        </ScrollReveal>

        {/* ── Contact + LeadForm ── */}
        <section className="counsel-contact" id="contact-form" aria-label="Contact">
          <div className="counsel-contact-info surface-inverse">
            <CounselSectionMark roman="VII" label="Reach us" />
            <h2 className="counsel-h2">
              <em className="counsel-h2-em">Free consultation</em> &mdash; call or write.
            </h2>
            <a href={tel} className="counsel-contact-phone num" aria-label={`Call ${phone}`}>
              {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <p className="counsel-contact-areas">
              Serving {areas.slice(0, 6).join(' · ')}
            </p>
          </div>
          <div className="counsel-contact-form">
            <LeadForm
              variant="counsel"
              heading="Request a Free Consultation"
              sub="Tell us about your matter — we respond within one business day."
              submit="Send request →"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="counsel-footer" aria-label="Site footer">
          <div className="counsel-footer-grid">
            {/* Brand + disclaimer */}
            <div>
              <a href="/" className="counsel-footer-brand" aria-label={`${bundle.business_name} home`}>
                <div className="counsel-footer-mark" aria-hidden>
                  <CounselScalesMark size={22} />
                </div>
                <span className="counsel-footer-name">{bundle.business_name}</span>
              </a>
              <p className="counsel-footer-desc">
                Local attorney representation for {bundle.city} families and small businesses.
                Free, confidential consultations.
              </p>
              {/* Attorney advertising disclaimer — required for lead-gen legal sites */}
              <p className="counsel-footer-disclaimer">
                This site is attorney advertising. Information presented here is not legal advice
                and does not create an attorney-client relationship.
              </p>
            </div>

            {/* Practice areas column */}
            <div className="counsel-footer-col">
              <div className="counsel-footer-col-label">Practice</div>
              <ul>
                {bundle.services.slice(0, 6).map((s) => (
                  <li key={s.slug}>
                    <a href={s.slug}>{s.title}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Reach us column */}
            <div className="counsel-footer-col">
              <div className="counsel-footer-col-label">Reach us</div>
              <ul>
                <li>
                  <a href={tel} className="num">{phone}</a>
                </li>
                <li>{bundle.city}, {bundle.state}</li>
                <li>Available 24/7</li>
              </ul>
            </div>
          </div>

          <div className="counsel-footer-bottom">
            <span>
              &copy; {new Date().getFullYear()} &middot; {bundle.business_name} &middot;{' '}
              {bundle.city}, {bundle.state}
            </span>
            <em>
              Member, {bundle.state} State Bar &middot; Attorney advertising
            </em>
          </div>
        </footer>

        {/* ── Sticky mobile bar — surface-inverse ── */}
        <div className="sticky-mobile-bar surface-inverse" aria-label="Quick contact" aria-hidden="false">
          <div>
            <div className="counsel-utility-accent" style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
              Free consultation
            </div>
            <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
              <Phone width={15} height={15} />
              {phone}
            </a>
          </div>
          <a href="#contact-form" className="cta">Request &rarr;</a>
        </div>
        <div className="counsel-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

/**
 * Inline SVG scales of justice hero illustration.
 * DECORATIVE — aria-hidden. The brass crossbeam group has the settle animation
 * class so CSS can target it without JS.
 */
function CounselHeroIllustration() {
  return (
    <svg
      viewBox="0 0 600 480"
      preserveAspectRatio="xMidYMid slice"
      className="counsel-hero-illustration"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="counselSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a4d3e" />
          <stop offset="55%" stopColor="#1c3a2e" />
          <stop offset="100%" stopColor="#0e2419" />
        </linearGradient>
        <radialGradient id="counselGlow" cx="0.5" cy="0.42" r="0.3">
          <stop offset="0%" stopColor="#C09A52" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#C09A52" stopOpacity="0" />
        </radialGradient>
        <filter id="counselGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" />
          <feColorMatrix values="0 0 0 0 0.69  0 0 0 0 0.53  0 0 0 0 0.26  0 0 0 0.08 0" />
        </filter>
      </defs>

      {/* Sky gradient */}
      <rect width="600" height="480" fill="url(#counselSky)" />
      <rect width="600" height="480" fill="url(#counselGlow)" />

      {/* Distant courthouse silhouette */}
      <g opacity="0.18" transform="translate(0 280)">
        <rect x="60" y="140" width="480" height="60" fill="#C09A52" />
        <rect x="100" y="120" width="400" height="20" fill="#C09A52" />
        <rect x="140" y="50" width="320" height="70" fill="#C09A52" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={170 + i * 50} y="50" width="14" height="70" fill="#1c3a2e" />
        ))}
        <path d="M 130 50 L 300 0 L 470 50 Z" fill="#C09A52" />
        <circle cx="300" cy="20" r="14" fill="#C09A52" />
        <rect x="296" y="-12" width="8" height="20" fill="#C09A52" />
      </g>

      {/* Scales of justice — crossbeam group has animate class */}
      <g transform="translate(300 200)">
        {/* pillar + base — static */}
        <rect x="-50" y="170" width="100" height="14" fill="#C09A52" rx="2" />
        <rect x="-36" y="158" width="72" height="12" fill="#C09A52" />
        <rect x="-4" y="-70" width="8" height="228" fill="#C09A52" />
        <circle cx="0" cy="-72" r="8" fill="#C09A52" />
        <circle cx="0" cy="-72" r="3" fill="#1c3a2e" />

        {/* crossbeam group — CSS settle animation targets this class */}
        <g className="counsel-scales-beam">
          <rect x="-130" y="-50" width="260" height="6" fill="#C09A52" rx="1" />
          {/* left chain + pan */}
          <line x1="-118" y1="-44" x2="-118" y2="-2" stroke="#C09A52" strokeWidth="2" />
          <line x1="-138" y1="-2" x2="-98" y2="-2" stroke="#C09A52" strokeWidth="2" />
          <line x1="-118" y1="-2" x2="-138" y2="40" stroke="#C09A52" strokeWidth="1.5" />
          <line x1="-118" y1="-2" x2="-98" y2="40" stroke="#C09A52" strokeWidth="1.5" />
          <ellipse cx="-118" cy="42" rx="44" ry="8" fill="#C09A52" />
          <path d="M -160 42 Q -118 70 -76 42 Z" fill="#8E6B30" opacity="0.7" />
          {/* right chain + pan */}
          <line x1="118" y1="-44" x2="118" y2="-2" stroke="#C09A52" strokeWidth="2" />
          <line x1="98" y1="-2" x2="138" y2="-2" stroke="#C09A52" strokeWidth="2" />
          <line x1="118" y1="-2" x2="98" y2="40" stroke="#C09A52" strokeWidth="1.5" />
          <line x1="118" y1="-2" x2="138" y2="40" stroke="#C09A52" strokeWidth="1.5" />
          <ellipse cx="118" cy="42" rx="44" ry="8" fill="#C09A52" />
          <path d="M 76 42 Q 118 70 160 42 Z" fill="#8E6B30" opacity="0.7" />
          {/* pillar highlight */}
          <line x1="-2" y1="-66" x2="-2" y2="150" stroke="#E5C383" strokeWidth="1" opacity="0.6" />
        </g>
      </g>

      {/* Grain texture overlay */}
      <rect width="600" height="480" fill="url(#counselGrain)" filter="url(#counselGrain)" opacity="0.4" />

      {/* Latin inscription — decorative */}
      <text
        x="300"
        y="448"
        textAnchor="middle"
        fill="#C09A52"
        opacity="0.45"
        fontFamily="'Source Serif 4', Georgia, serif"
        fontStyle="italic"
        fontSize="13"
        letterSpacing="0.18em"
      >
        lex &middot; libertas &middot; ratio
      </text>
    </svg>
  );
}

/** Small scales-of-justice mark used in the logo block and footer. */
function CounselScalesMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="14.5" y="6" width="3" height="22" fill="var(--accent)" />
      <rect x="6" y="9" width="20" height="2" fill="var(--accent)" />
      <circle cx="16" cy="6" r="2" fill="var(--accent)" />
      <ellipse cx="9" cy="16" rx="4" ry="1.5" fill="var(--accent)" />
      <ellipse cx="23" cy="16" rx="4" ry="1.5" fill="var(--accent)" />
      <rect x="10" y="26" width="12" height="2" fill="var(--accent)" />
    </svg>
  );
}

/** Roman-numeral editorial section mark. */
function CounselSectionMark({ roman, label }: { roman: string; label: string }) {
  return (
    <div className="counsel-section-mark">
      <span className="counsel-section-mark-roman">{roman}.</span>
      <span className="counsel-section-mark-rule" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** Brass diamond divider used between editorial sections. */
function CounselDivider() {
  return (
    <div className="counsel-divider" aria-hidden>
      <span className="counsel-divider-line" />
      <span className="counsel-divider-diamond" />
      <span className="counsel-divider-line" />
    </div>
  );
}
