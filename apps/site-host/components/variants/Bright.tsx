import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref, titleCaseKeyword } from '../../lib/content';
import { deriveAreas, areaSlugByTitle, deriveFaqs, deriveBlogTeasers, firstReview } from '../../lib/variant-utils';
import { LeadForm } from '../shared/LeadForm';
import { LocalBusinessJsonLd, FaqJsonLd } from '../shared/LocalBusinessJsonLd';
import { MapEmbed } from '../shared/MapEmbed';
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

const SERVICE_BG = ['bg-coral', 'bg-sun', 'bg-mint', 'bg-sky'] as const;

/**
 * Variant D — Bright Approachable.
 * Bricolage 700 + Plus Jakarta Sans. Cream + coral. Rotating pastel cards,
 * squiggle SVG underline on hero keyword, sticky-note callout, dashed dividers.
 * For cleaning, junk removal, pest, lawn care, dog walking, mobile detail.
 *
 * Footprint divergence (ADR 0012 §3): eyebrow/button copy is deliberately
 * warmer and more conversational than Classic/Modern/Premium. Section order
 * is: hero → trust band → services → gallery → phone strip → proof → FAQ
 * → CTA/areas → info pages → blog → footer. (Other variants differ.)
 */
export function BrightHome({
  bundle,
  phone,
  siteId,
  siteSlug,
  pageUrl = 'https://example.com',
}: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Bonded & insured', 'You approve before we start', 'Same crew every time'];

  // Foundation helpers — replaces inline uniq + derivation logic
  const areas = deriveAreas(bundle);
  const slugByTitle = areaSlugByTitle(bundle);
  const faqs = deriveFaqs(bundle);
  const blogTeasers = deriveBlogTeasers(bundle);
  const review = firstReview(bundle);

  const initials = bundle.business_name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toLowerCase();

  // SEO: render the exact targeted keyword phrase verbatim as H1, with the
  // niche term underlined by the squiggle when it appears inside the phrase.
  const renderHeroH1 = () => {
    const h1 = titleCaseKeyword(heroH1(bundle));
    const keyword = bundle.niche;
    const idx = h1.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx < 0) {
      return h1;
    }
    const before = h1.slice(0, idx);
    const match = h1.slice(idx, idx + keyword.length);
    const after = h1.slice(idx + keyword.length);
    return (
      <>
        {before}
        <span className="squiggle">{match}</span>
        {after}
      </>
    );
  };

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={faqs} />
      <SiteNavigationJsonLd bundle={bundle} baseUrl={baseUrl} />

      <div className="bright-shell">
        <header className="bright-header">
          <a href="/" className="bright-brand">
            <span className="bright-mark" aria-hidden>
              {initials}
            </span>
            <span>
              <span className="bright-brand-name">{bundle.business_name}</span>
              <span className="bright-brand-sub">
                {bundle.city.toLowerCase()} · {bundle.niche.toLowerCase()}
              </span>
            </span>
          </a>
          <div className="bright-header-cta">
            <a href={tel} className="bright-phone-pill num" aria-label={`Call ${phone}`}>
              <Phone width={16} height={16} className="bright-phone-icon" />
              {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <a href="#contact" className="bright-cta-pill">
              Get a free quote
            </a>
          </div>
        </header>

        {/* top nav — inserted immediately after header */}
        <SiteNav bundle={bundle} variant="bright" />

        {/* ABOVE THE FOLD — no ScrollReveal here */}
        <section className="bright-hero" aria-labelledby="hero-h1">
          <svg
            className="bright-hero-svg"
            viewBox="0 0 880 380"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden
          >
            <path
              d="M-20 240 Q 200 180 380 220 T 760 200 Q 880 200 920 280 L 920 380 L -20 380 Z"
              fill="var(--coral-50)"
              stroke="var(--ink)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <circle
              cx="120"
              cy="80"
              r="36"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <circle cx="780" cy="60" r="22" fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.2" />
          </svg>

          <div className="bright-hero-grid">
            <div>
              <p className="bright-eyebrow">
                {bundle.niche} · {bundle.city}, {bundle.state}
              </p>
              {/* ADR 0002: H1 renders targeted keyword verbatim; squiggle underlines niche term */}
              <h1 id="hero-h1" className="bright-h1">
                {renderHeroH1()}
              </h1>
              <p className="bright-lede">{bundle.home.meta_description}</p>
              {/* response_time_promise: surface as friendly plain text when present */}
              {bundle.response_time_promise && (
                <p className="bright-response-promise">{bundle.response_time_promise}</p>
              )}
              <div className="bright-hero-buttons">
                <a href="#contact" className="bright-btn bright-btn-primary">
                  Get a free quote
                </a>
                <a href={tel} className="bright-btn bright-btn-secondary num" aria-label={`Call ${phone}`}>
                  <Phone width={18} height={18} />
                  {phone}
                </a>
              </div>
              <ul className="bright-trust">
                {trust.slice(0, 4).map((t) => (
                  <li key={t}>
                    <Check width={16} height={16} className="bright-trust-check" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bright-hero-image-wrap">
              <div className="bright-hero-image">
                {bundle.hero_image_url ? (
                  <Image
                    src={bundle.hero_image_url}
                    alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
                    fill
                    priority
                    fetchPriority="high"
                    sizes="(max-width: 768px) 280px, 280px"
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <div className="bright-hero-placeholder">[hero]</div>
                )}
              </div>
              <div className="bright-sticky-note" aria-hidden>
                same friendly crew, every visit
              </div>
            </div>
          </div>
        </section>

        {/* trust band — neighbor-with-a-crew tone, pastel chips */}
        <ScrollReveal as="section" className="bright-trust-band" aria-label="Trust signals">
          <p className="bright-trust-band-eyebrow">your neighborhood crew —</p>
          <ul className="bright-trust-band-chips">
            {trust.slice(0, 4).map((t) => (
              <li key={t}>
                <Check width={14} height={14} aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </ScrollReveal>

        {/* TrustStrip (pills) — below hero */}
        <TrustStrip bundle={bundle} variant="bright" />

        {/* services — section order: services before phone strip for Bright */}
        <ScrollReveal as="section" className="bright-services" id="services">
          <div className="bright-section-head">
            <div>
              <p className="bright-eyebrow">What we do</p>
              <h2 className="bright-h2">Our services</h2>
            </div>
            <span className="bright-section-aside">not sure which fits? just ask →</span>
          </div>
          <div className="bright-services-grid">
            {bundle.services.map((s, i) => (
              <a
                key={s.slug}
                href={s.slug}
                className={`bright-service-card ${SERVICE_BG[i % SERVICE_BG.length]}`}
              >
                <div className="bright-service-row">
                  <span className="bright-service-icon" aria-hidden>
                    {/* Decorative index-based shape, no emoji */}
                    {['◐', '◑', '◒', '◓', '◍', '◎'][i % 6]}
                  </span>
                  <h3 className="bright-service-title">{s.title}</h3>
                </div>
                <p className="bright-service-blurb">{s.meta_description}</p>
                <span className="bright-service-link">Learn more →</span>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* PhotoGallery — below services */}
        <PhotoGallery bundle={bundle} variant="bright" />

        {/* mid-page phone moment — friendly framing */}
        <ScrollReveal as="section" className="bright-phone-strip" aria-label="Call us">
          <p className="bright-phone-strip-eyebrow">prefer to talk? we love that</p>
          <a href={tel} className="bright-phone-strip-num num" aria-label={`Call ${phone}`}>
            <Phone width={32} height={32} className="bright-phone-strip-icon" />
            {phone}
          </a>
          <p className="bright-phone-strip-sub">picked up by a real person, usually within a few rings</p>
        </ScrollReveal>

        {/* Proof element — firstReview plain text card. No review schema. */}
        {review && (
          <ScrollReveal as="section" className="bright-proof" aria-label="Customer story">
            <div className="bright-proof-card">
              <p className="bright-proof-quote">{review.text}</p>
              <p className="bright-proof-attribution">
                {review.author}
                {review.source === 'google' || review.source === 'yelp'
                  ? ` · via ${review.source.charAt(0).toUpperCase() + review.source.slice(1)}`
                  : ''}
              </p>
            </div>
          </ScrollReveal>
        )}

        {/* ReviewsSection — above FAQ */}
        <ReviewsSection bundle={bundle} variant="bright" title="What our neighbors say" />

        {faqs.length > 0 && (
          <ScrollReveal as="section" className="bright-faq" aria-label="Frequently asked questions">
            <div className="bright-section-head">
              <div>
                <p className="bright-eyebrow">good questions</p>
                <h2 className="bright-h2">Glad you asked</h2>
              </div>
              <span className="bright-section-aside">still have one? just call →</span>
            </div>
            <div className="bright-faq-list">
              {faqs.map((f, i) => (
                <details key={i} className="bright-faq-item" open={i === 0}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </ScrollReveal>
        )}

        <ScrollReveal as="section" className="bright-cta-row" id="contact">
          <div className="bright-cta-card">
            <h2 className="bright-cta-h2">Ready when you are.</h2>
            <p className="bright-cta-sub">
              Most weeks we have same-week openings. Drop your info and we will follow up same day.
            </p>
            <LeadForm
              variant="bright"
              submit="Send my request"
              source="home-cta"
              siteId={siteId}
              siteSlug={siteSlug}
            />
            <div className="bright-cta-or">
              <span>or just call —</span>
              <a href={tel} className="bright-cta-phone num" aria-label={`Call ${phone}`}>
                <Phone width={16} height={16} />
                {phone}
              </a>
              <CallNowBadge bundle={bundle} />
            </div>
          </div>
          <div className="bright-areas-card" id="where">
            <h2 className="bright-h2">We come to —</h2>
            <CertificationsRow bundle={bundle} variant="bright" />
            <GuaranteesList bundle={bundle} />
            <ul className="bright-area-chips">
              {areas.map((c) => {
                const slug = slugByTitle.get(c);
                return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
              })}
            </ul>
            <MapEmbed
              className="bright-map-frame"
              city={bundle.city}
              state={bundle.state}
              height={280}
            />
          </div>
        </ScrollReveal>

        {bundle.info_pages.length > 0 && (
          <ScrollReveal as="section" className="bright-learn-more" aria-label="Resources" delay={100}>
            <p className="bright-eyebrow">Learn more</p>
            <h2 className="bright-h2">Tips and guides</h2>
            <div className="bright-learn-grid">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <a key={p.slug} href={p.slug} className="bright-learn-card">
                  <span className="bright-learn-title">{p.title}</span>
                  <span className="bright-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </ScrollReveal>
        )}

        {blogTeasers.length > 0 && (
          <ScrollReveal as="section" className="bright-learn-more" aria-label="From the blog" delay={100}>
            <p className="bright-eyebrow">From the blog</p>
            <h2 className="bright-h2">Recent articles</h2>
            <div className="bright-learn-grid">
              {blogTeasers.map((p) => (
                <a key={p.slug} href={p.slug} className="bright-learn-card">
                  <span className="bright-learn-title">{p.title}</span>
                  <span className="bright-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </ScrollReveal>
        )}

        <footer className="bright-footer surface-inverse">
          <div>
            &copy; {new Date().getFullYear()} {bundle.business_name} &middot; Bonded &amp; insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
        </footer>

        <div className="sticky-mobile-bar surface-inverse">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            <Phone width={18} height={18} />
            {phone}
          </a>
          <a href="#contact" className="cta">
            Book now
          </a>
        </div>
        <div className="bright-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}
