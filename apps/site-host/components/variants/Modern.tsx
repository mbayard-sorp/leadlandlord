import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref, titleCaseKeyword, pageHref } from '../../lib/content';
import { LeadForm } from '../shared/LeadForm';
import { LocalBusinessJsonLd, FaqJsonLd } from '../shared/LocalBusinessJsonLd';
import { MapEmbed } from '../shared/MapEmbed';
import { VideoEmbed } from '../shared/VideoEmbed';
import { LongformSection } from '../shared/LongformSection';
import { SiteNav } from '../shared/SiteNav';
import { SiteNavigationJsonLd } from '../shared/SiteNavigationJsonLd';
import { TrustStrip } from '../shared/TrustStrip';
import { ReviewsSection } from '../shared/ReviewsSection';
import { PhotoGallery } from '../shared/PhotoGallery';
import { CertificationsRow } from '../shared/CertificationsRow';
import { GuaranteesList } from '../shared/GuaranteesList';
import { CallNowBadge } from '../shared/CallNowBadge';
import { Phone } from '../icons/Phone';
import { Check } from '../icons/Check';
import { ScrollReveal } from '../motion/ScrollReveal';
import {
  deriveAreas,
  areaSlugByTitle,
  deriveFaqs,
  deriveBlogTeasers,
  firstReview,
} from '../../lib/variant-utils';

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
 * Variant B — Modern / Swiss-System.
 * Bricolage Grotesque + DM Sans, deep aqua, rule-separated modules, tabular
 * numerals, uppercase tracked labels. Terse, spec-forward voice.
 * For solar, EV, smart-home, water-heater install.
 */
export function ModernHome({ bundle, phone, siteId, siteSlug, pageUrl = 'https://example.com' }: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');

  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Licensed & insured', 'Free quote in 24 h', 'Federal tax credit help'];

  const areas = deriveAreas(bundle);
  const slugByTitle = areaSlugByTitle(bundle);
  const faqs = deriveFaqs(bundle);
  const blogTeasers = deriveBlogTeasers(bundle);
  const review = firstReview(bundle);

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={faqs} />
      <SiteNavigationJsonLd bundle={bundle} baseUrl={baseUrl} />

      <div className="modern-shell">
        <header className="modern-header">
          <a href="/" className="modern-brand">
            {bundle.logo_url
              ? <Image src={bundle.logo_url} alt="" width={30} height={30} className="modern-logo" />
              : <span className="modern-mark" aria-hidden />}
            <span className="modern-brand-name">{bundle.business_name}</span>
          </a>
          <div className="modern-header-cta">
            <a href={tel} className="modern-phone-pill num">
              <Phone width={16} height={16} className="modern-phone-icon" />
              {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <a href="#contact" className="modern-cta-pill">
              Request quote
            </a>
          </div>
        </header>

        {/* top nav — inserted immediately after header */}
        <SiteNav bundle={bundle} variant="modern" showAllPages />

        {/* HERO — above the fold, no ScrollReveal, no motion wrapper */}
        <section className="modern-hero" aria-labelledby="hero-h1">
          <svg
            className="modern-hero-svg"
            viewBox="0 0 880 480"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <defs>
              <linearGradient id="modern-g1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0.04" />
              </linearGradient>
            </defs>
            <circle cx="780" cy="120" r="220" fill="url(#modern-g1)" />
            <circle cx="120" cy="380" r="140" fill="var(--accent)" opacity="0.15" />
            <rect
              x="640"
              y="220"
              width="160"
              height="160"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1"
              transform="rotate(15 720 300)"
            />
            <line x1="0" y1="240" x2="880" y2="240" stroke="var(--rule)" strokeWidth="1" />
          </svg>

          <div className="modern-hero-image">
            {bundle.hero_image_url ? (
              <Image
                src={bundle.hero_image_url}
                alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
                fill
                priority
                fetchPriority="high"
                sizes="(max-width: 768px) 100vw, 1200px"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="modern-hero-placeholder">[hero photo]</div>
            )}
          </div>

          <div className="modern-hero-grid">
            <div>
              <p className="modern-eyebrow">
                {bundle.city}, {bundle.state}
              </p>
              {/* ADR 0002: H1 renders targeted keyword verbatim, title-cased. */}
              <h1 id="hero-h1" className="modern-h1">
                {titleCaseKeyword(heroH1(bundle))}
              </h1>
              <p className="modern-lede">{bundle.home.meta_description}</p>
              <div className="modern-hero-buttons">
                <a href="#contact" className="modern-btn modern-btn-primary">
                  Request quote
                </a>
                <a href={tel} className="modern-btn modern-btn-secondary num">
                  <Phone width={16} height={16} aria-hidden />
                  {phone}
                </a>
              </div>
              <ul className="modern-trust">
                {trust.slice(0, 4).map((t) => (
                  <li key={t}>
                    <Check width={14} height={14} className="modern-trust-check" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* LeadForm is above the fold — no ScrollReveal */}
            <div className="modern-form-card">
              <p className="modern-form-card-eyebrow">Free estimate</p>
              <h3 className="modern-form-card-h2">Reply within one business day</h3>
              <p className="modern-form-card-sub">
                No spam. No unsolicited calls.
              </p>
              <LeadForm variant="modern" submit="Submit request" source="hero" siteId={siteId} siteSlug={siteSlug} />
            </div>
          </div>
        </section>

        {/* video under hero (manual) + keyword-rich long-form intro */}
        <VideoEmbed
          url={bundle.video_url}
          description={bundle.video_description}
          className="ll-video modern-video"
        />
        <LongformSection
          body={bundle.longform_body}
          phone={phone}
          className="ll-longform modern-longform"
        />

        {/* trust band — above fold, no ScrollReveal */}
        <section className="modern-trust-band" aria-label="Trust signals">
          {trust.slice(0, 4).map((t) => (
            <div key={t} className="modern-trust-band-item">{t}</div>
          ))}
        </section>

        {/* TrustStrip (counters) — below hero/trust band, above fold boundary */}
        <TrustStrip bundle={bundle} variant="modern" />

        {/* First review proof — plain text only, no schema. ADR 0012 §4. */}
        {review && (
          <aside className="modern-proof-strip" aria-label="Customer review">
            <blockquote className="modern-proof-quote">
              <p className="modern-proof-text">&ldquo;{review.text}&rdquo;</p>
              <footer className="modern-proof-attribution">
                {review.author}
                {bundle.city ? ` · ${bundle.city}` : ''}
              </footer>
            </blockquote>
            {bundle.response_time_promise && (
              <p className="modern-response-promise">{bundle.response_time_promise}</p>
            )}
          </aside>
        )}

        {/* If no review but response_time_promise exists, surface it alone */}
        {!review && bundle.response_time_promise && (
          <aside className="modern-proof-strip" aria-label="Response time">
            <p className="modern-response-promise">{bundle.response_time_promise}</p>
          </aside>
        )}

        {/* BELOW THE FOLD — wrap each section in ScrollReveal */}
        <ScrollReveal as="section" className="modern-services" id="services">
          <header className="modern-section-head">
            <p className="modern-eyebrow">Scope of work</p>
            <h2 className="modern-h2">Services</h2>
          </header>
          <div className="modern-services-grid">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={pageHref(s)} className="modern-service-card">
                <span className="modern-service-index" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="modern-service-title">{s.title}</h3>
                <p className="modern-service-blurb">{s.meta_description}</p>
                <span className="modern-service-link">Details</span>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* ReviewsSection */}
        <ScrollReveal className="modern-reviews-wrap">
          <ReviewsSection bundle={bundle} variant="modern" />
        </ScrollReveal>

        {/* PhotoGallery */}
        <ScrollReveal className="modern-gallery-wrap">
          <PhotoGallery bundle={bundle} variant="modern" />
        </ScrollReveal>

        {/* BIG phone block */}
        <ScrollReveal as="section" className="modern-phone-block">
          <p className="modern-phone-block-eyebrow">{bundle.niche} — direct line</p>
          <a href={tel} className="modern-phone-block-num num">
            <Phone width={28} height={28} className="modern-phone-block-icon" aria-hidden />
            {phone}
          </a>
          <CallNowBadge bundle={bundle} />
          <p className="modern-phone-block-sub">Tap to call · same-day response · no charge for quotes</p>
        </ScrollReveal>

        {(faqs.length > 0 || areas.length > 0) && (
          <ScrollReveal as="section" className="modern-faq-areas" id="where">
            <div className="modern-faq">
              <p className="modern-eyebrow">Common questions</p>
              <h2 className="modern-h2">FAQ</h2>
              {faqs.length === 0 ? (
                <p className="modern-lede" style={{ marginTop: 16 }}>
                  Questions? Call — we answer on the first ring.
                </p>
              ) : (
                <div className="modern-faq-list">
                  {faqs.map((f, i) => (
                    <details key={i} className="modern-faq-item" open={i === 0}>
                      <summary>{f.q}</summary>
                      <p>{f.a}</p>
                    </details>
                  ))}
                </div>
              )}
            </div>
            <div className="modern-areas">
              <p className="modern-eyebrow">Coverage</p>
              <h2 className="modern-h2">Where we work</h2>
              <ul className="modern-area-chips">
                {areas.map((c) => {
                  const slug = slugByTitle.get(c);
                  return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
                })}
              </ul>
              <MapEmbed
                className="modern-map-frame"
                city={bundle.city}
                state={bundle.state}
                height={300}
              />
            </div>
          </ScrollReveal>
        )}

        {/* fallback #where anchor when the combined section is absent */}
        {faqs.length === 0 && areas.length === 0 && (
          <span id="where" aria-hidden style={{ display: 'none' }} />
        )}

        {bundle.info_pages.length > 0 && (
          <ScrollReveal as="section" className="modern-learn-more" aria-label="Resources">
            <p className="modern-eyebrow">Reference</p>
            <h2 className="modern-h2">Local guides</h2>
            <div className="modern-learn-grid">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <a key={p.slug} href={pageHref(p)} className="modern-learn-card">
                  <span className="modern-learn-title">{p.title}</span>
                  <span className="modern-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </ScrollReveal>
        )}

        {blogTeasers.length > 0 && (
          <ScrollReveal as="section" className="modern-learn-more" aria-label="From the blog">
            <p className="modern-eyebrow">Writing</p>
            <h2 className="modern-h2">Recent articles</h2>
            <div className="modern-learn-grid">
              {blogTeasers.map((p) => (
                <a key={p.slug} href={pageHref(p)} className="modern-learn-card">
                  <span className="modern-learn-title">{p.title}</span>
                  <span className="modern-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </ScrollReveal>
        )}

        {/* CertificationsRow + GuaranteesList */}
        <ScrollReveal className="modern-trust-footer-block">
          <CertificationsRow bundle={bundle} variant="modern" />
          <GuaranteesList bundle={bundle} />
        </ScrollReveal>

        <ScrollReveal as="section" className="modern-cta" id="contact">
          <p className="modern-eyebrow modern-cta-eyebrow">Start here</p>
          <h2 className="modern-cta-h2">Get a quote</h2>
          <p className="modern-cta-sub">15-minute call. No commitment.</p>
          <a href={tel} className="modern-cta-phone num">
            <Phone width={20} height={20} aria-hidden />
            {phone}
          </a>
          <CallNowBadge bundle={bundle} />
        </ScrollReveal>

        <footer className="modern-footer surface-inverse">
          <div>
            &copy; {new Date().getFullYear()} {bundle.business_name} &middot; Licensed &amp; insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
        </footer>

        <div className="sticky-mobile-bar surface-inverse">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            <Phone width={16} height={16} aria-hidden />
            {phone}
          </a>
          <a href="#contact" className="cta">
            Get quote
          </a>
        </div>
        <div className="modern-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}
