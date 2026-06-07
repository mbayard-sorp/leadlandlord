import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref } from '../../lib/content';
import { deriveAreas, areaSlugByTitle, deriveFaqs, deriveBlogTeasers, firstReview } from '../../lib/variant-utils';
import { VideoEmbed } from '../shared/VideoEmbed';
import { LongformSection } from '../shared/LongformSection';
import { Phone } from '../icons/Phone';
import { Check } from '../icons/Check';
import { Star } from '../icons/Star';
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
 * Variant A — Trade-Classic.
 * Warm-Modern. Sunlit, human, composed. The neighbor's trusted crew.
 * For HVAC, plumbing, electrical, gutter, roofing, fence, septic.
 *
 * Type: Oswald 700 uppercase display + Public Sans body.
 * Color: Ink #0F1620 + Paper #FBFAF6 + Accent safety-orange #E85D10.
 * Borders: 2px Ink, 2-4px radius. No shadows.
 * Voice: warm, direct, family-owned. "We pick up." "Your neighbors' crew."
 */
export function ClassicHome({ bundle, phone, siteId, siteSlug, pageUrl = 'https://example.com' }: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');

  // Trust signals: Classic falls back to warm/human defaults, not generic ones.
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Licensed & insured', 'Your neighbors’ crew', 'Free honest quotes', 'We pick up'];

  // Derived data — via shared variant-utils helpers.
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

      <div className="classic-shell">
        {/* utility bar */}
        <div className="classic-utility surface-inverse">
          <span>
            <Star width={12} height={12} className="classic-utility-star" />
            {' '}Family-owned &middot; {bundle.city}, {bundle.state}
          </span>
          <span className="hidden sm:inline">Open 7am &ndash; 9pm &middot; 7 days</span>
        </div>

        {/* header — brand wordmark + phone pill */}
        <header className="classic-header">
          <a href="/" className="classic-brand">
            {bundle.logo_url
              ? <Image src={bundle.logo_url} alt="" width={28} height={28} className="classic-logo" />
              : <span className="classic-mark" aria-hidden />}
            <span className="classic-brand-name">{bundle.business_name}</span>
          </a>
          <a href={tel} className="classic-phone-pill num">
            <Phone width={15} height={15} />
            {phone}
          </a>
        </header>

        {/* top nav */}
        <SiteNav bundle={bundle} variant="classic" showAllPages />

        {/* hero — above fold, no ScrollReveal, no motion wrapper */}
        <section className="classic-hero" aria-labelledby="hero-h1">
          <div className="classic-hero-text">
            <p className="classic-eyebrow">
              {bundle.city}, {bundle.state} &middot; Your neighbors&rsquo; crew
            </p>
            {/* ADR 0002: H1 renders the exact targeted keyword phrase verbatim; CSS uppercases it. */}
            <h1 id="hero-h1" className="classic-h1">
              {heroH1(bundle)}
            </h1>
            <div className="classic-hero-rule" aria-hidden />
            <p className="classic-lede">
              {bundle.home.meta_description}
            </p>
            {bundle.response_time_promise && (
              <p className="classic-availability">{bundle.response_time_promise}</p>
            )}
            <div className="classic-hero-buttons">
              <a href={tel} className="classic-btn classic-btn-primary">
                <Phone width={16} height={16} />
                Call {phone}
              </a>
              <a href="#contact" className="classic-btn classic-btn-secondary">Get your free quote &rarr;</a>
            </div>
            <CallNowBadge bundle={bundle} />
            <ul className="classic-hero-trust">
              {trust.slice(0, 3).map((t) => (
                <li key={t}>
                  <Check width={14} height={14} className="classic-check-icon" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="classic-hero-image">
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
              <div className="classic-hero-placeholder">[hero photo]</div>
            )}
          </div>
        </section>

        {/* video under hero (manual) + keyword-rich long-form intro */}
        <VideoObjectJsonLd bundle={bundle} url={pageUrl} />
        <VideoEmbed
          url={bundle.video_url}
          description={bundle.video_description}
          className="ll-video classic-video"
        />
        <LongformSection
          body={bundle.longform_body}
          phone={phone}
          className="ll-longform classic-longform"
        />

        {/* TrustStrip — right under hero, above fold, no ScrollReveal */}
        <TrustStrip bundle={bundle} variant="classic" />

        {/* Proof element: first real review as plain text, no review schema */}
        {review && (
          <div className="classic-proof-strip">
            <blockquote className="classic-proof-quote">
              &ldquo;{review.text}&rdquo;
            </blockquote>
            <cite className="classic-proof-author">&mdash; {review.author}</cite>
          </div>
        )}

        {/* CertificationsRow — below proof strip */}
        <CertificationsRow bundle={bundle} variant="classic" />

        {/* BIG phone block — Classic hallmark; warm eyebrow copy */}
        <section className="classic-phone-block">
          <p className="classic-phone-eyebrow">Real people. We pick up.</p>
          <a href={tel} className="classic-phone-big num">{phone}</a>
          <CallNowBadge bundle={bundle} />
          <p className="classic-phone-sub">
            <Phone width={14} height={14} className="classic-phone-sub-icon" />
            Tap to call &middot; 7am &ndash; 9pm, 7 days &middot; free quotes
          </p>
        </section>

        {/* trust strip on dark */}
        <section className="classic-trust-strip surface-inverse" aria-label="Trust signals">
          {trust.slice(0, 4).map((t, i) => (
            <div key={t}>
              <div className="classic-trust-eyebrow">{['Licensed & insured', 'Your neighbors’ crew', 'Free honest quotes', 'We pick up'][i] ?? t}</div>
              <div className="classic-trust-detail">{t}</div>
            </div>
          ))}
          <GuaranteesList bundle={bundle} />
        </section>

        {/* numbered services */}
        <ScrollReveal as="section" className="classic-services" id="services">
          <header className="classic-section-head">
            <p className="classic-section-eyebrow">How we help</p>
            <h2 className="classic-h2">Our services</h2>
          </header>
          <div className="classic-services-grid">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={s.slug} className="classic-service-tile">
                <div className="classic-service-num num">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="classic-service-title">{s.title}</h3>
                <p className="classic-service-blurb">{s.meta_description}</p>
                <span className="classic-service-link">LEARN MORE &rarr;</span>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* PhotoGallery — below services grid */}
        <PhotoGallery bundle={bundle} variant="classic" />

        {/* service areas */}
        <ScrollReveal as="section" className="classic-areas" id="where">
          <p className="classic-section-eyebrow">Right in your backyard</p>
          <h2 className="classic-h2">{bundle.city} &amp; nearby towns</h2>
          <ul className="classic-area-chips">
            {areas.map((c) => {
              const slug = slugByTitle.get(c);
              return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
            })}
          </ul>
          <MapEmbed
            className="classic-map-frame"
            city={bundle.city}
            state={bundle.state}
            height={320}
          />
        </ScrollReveal>

        {/* Neighborhoods — thin-mode home page service-area section */}
        {bundle.neighborhoods.length > 0 && (
          <ScrollReveal as="section" className="classic-areas" aria-label="Neighborhoods we serve">
            <p className="classic-section-eyebrow">Neighborhoods we serve</p>
            <h2 className="classic-h2">Local service across {bundle.city}</h2>
            <ul className="classic-area-chips">
              {bundle.neighborhoods.map((n) => (
                <li key={n.name}>
                  <a href={n.googleMapsUrl} target="_blank" rel="noopener noreferrer">
                    {n.name}
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {/* FAQ */}
        {faqs.length > 0 && (
          <ScrollReveal as="section" className="classic-faq" aria-label="FAQ">
            <p className="classic-section-eyebrow">Good question</p>
            <h2 className="classic-h2">Questions our neighbors ask</h2>
            <dl className="classic-faq-list">
              {faqs.map((f, i) => (
                <details key={i} className="classic-faq-item" open={i === 0}>
                  <summary>
                    <dt>{f.q}</dt>
                  </summary>
                  <dd>{f.a}</dd>
                </details>
              ))}
            </dl>
          </ScrollReveal>
        )}

        {/* Learn more — links to /pages/[slug] */}
        {bundle.info_pages.length > 0 && (
          <ScrollReveal as="section" className="classic-learn-more" aria-label="Resources">
            <p className="classic-section-eyebrow">Good reads</p>
            <h2 className="classic-h2">Local guides &amp; info</h2>
            <ul className="classic-learn-list">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="classic-learn-title">{p.title}</span>
                    <span className="classic-learn-arrow">&rarr;</span>
                    <span className="classic-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {/* From the blog — links to /blog/[slug] */}
        {blogTeasers.length > 0 && (
          <ScrollReveal as="section" className="classic-learn-more" aria-label="From the blog">
            <p className="classic-section-eyebrow">From our crew</p>
            <h2 className="classic-h2">Recent articles</h2>
            <ul className="classic-learn-list">
              {blogTeasers.map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="classic-learn-title">{p.title}</span>
                    <span className="classic-learn-arrow">&rarr;</span>
                    <span className="classic-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {/* ReviewsSection — above the LeadForm contact section */}
        <ReviewsSection bundle={bundle} variant="classic" />

        {/* contact + form */}
        <ScrollReveal as="section" className="classic-contact" id="contact">
          <div className="classic-contact-info surface-inverse">
            <p className="classic-section-eyebrow" data-accent>Ready to help</p>
            <h2 className="classic-h2">Call us &mdash; we pick up.</h2>
            <a href={tel} className="classic-phone-block-inline num" data-accent>
              <Phone width={20} height={20} className="classic-contact-phone-icon" />
              {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <p>Open 7am &ndash; 9pm, 7 days a week.</p>
            <p className="classic-contact-areas">
              Serving {areas.slice(0, 6).join(' · ')}
            </p>
          </div>
          <div className="classic-contact-form">
            <LeadForm
              variant="classic"
              heading="Get a free, honest quote"
              sub="Or just call — we pick up every time."
              submit="SEND &rarr;"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </ScrollReveal>

        {/* footer */}
        <footer className="classic-footer surface-inverse">
          <div>&copy; {new Date().getFullYear()} {bundle.business_name} &middot; Licensed &amp; insured{bundle.license_number ? ` · Licensed #${bundle.license_number}` : ''}</div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
        </footer>

        {/* sticky mobile bar */}
        <div className="sticky-mobile-bar surface-inverse" aria-hidden="false">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            <Phone width={16} height={16} />
            {phone}
          </a>
          <a href="#contact" className="cta">Free quote</a>
        </div>
        <div className="classic-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}
