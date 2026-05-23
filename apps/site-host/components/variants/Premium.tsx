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
import { CallNowBadge } from '../shared/CallNowBadge';
import { Phone } from '../icons/Phone';
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

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * Variant C — Premium Curated.
 * DM Serif Display + Cormorant italic + Source Serif 4. Cream + ink.
 * Full-bleed editorial hero, hairline rules, no cards, roman-numeral eyebrows.
 * For custom landscape, kitchen remodel, pool builders, fine carpentry.
 *
 * Voice: restrained, composed, understated luxury. Calm confidence. No urgency.
 * Rhythm: hero → editorial lede/about → services → quiet proof → contact.
 */
export function PremiumHome({
  bundle,
  phone,
  siteId,
  siteSlug,
  pageUrl = 'https://example.com',
}: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');
  const heroImg = bundle.hero_image_url;
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['By appointment', 'Licensed & insured', 'Considered work'];

  // Derivation via shared helpers (no more local uniq / inline filters)
  const areas = deriveAreas(bundle).slice(0, 8);
  const areaMap = areaSlugByTitle(bundle);
  const faqs = deriveFaqs(bundle);
  const blogTeasers = deriveBlogTeasers(bundle);
  const review = firstReview(bundle);

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={faqs} />
      <SiteNavigationJsonLd bundle={bundle} baseUrl={baseUrl} />

      <div className="premium-shell">
        <div className="premium-utility">
          <span>
            {bundle.city} · {bundle.state}
          </span>
          <span className="num premium-utility-phone">
            <Phone width={13} height={13} className="premium-utility-icon" />
            {' '}{phone}
          </span>
        </div>

        <header className="premium-header">
          <a href="/" className="premium-brand">
            {bundle.logo_url && (
              <Image src={bundle.logo_url} alt="" width={32} height={32} className="premium-logo" />
            )}
            {bundle.business_name}
          </a>
          <SiteNav bundle={bundle} variant="premium" className="premium-nav" />
        </header>

        {/* ABOVE THE FOLD: hero — no ScrollReveal, no motion wrapper */}
        <section
          className="premium-hero"
          aria-labelledby="hero-h1"
        >
          {heroImg ? (
            <Image
              src={heroImg}
              alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
              fill
              priority
              fetchPriority="high"
              sizes="100vw"
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className="premium-hero-placeholder" aria-hidden />
          )}
          <div className="premium-hero-overlay">
            <div>
              <p className="premium-hero-eyebrow">
                {bundle.city}, {bundle.state}
              </p>
              {/* ADR 0002: H1 renders the targeted keyword phrase verbatim, title-cased. */}
              <h1 id="hero-h1" className="premium-h1">
                {titleCaseKeyword(heroH1(bundle))}
              </h1>
              {(bundle.license_number || bundle.insurance_carrier) ? (
                <p className="premium-trust-line">
                  By appointment
                  {bundle.license_number ? ` · Licensed #${bundle.license_number}` : ''}
                  {bundle.insurance_carrier ? ' · Insured' : ''}
                </p>
              ) : (
                <p className="premium-trust-line">{trust.join(' · ')}</p>
              )}
            </div>
          </div>
        </section>

        {/* BELOW THE FOLD: all sections wrapped in ScrollReveal */}

        <ScrollReveal as="section" className="premium-lede-band" id="practice">
          <p className="premium-roman">{ROMAN[0]}. The Practice</p>
          <CertificationsRow bundle={bundle} variant="premium" />
          <p className="premium-lede">{bundle.home.meta_description}</p>
          <div className="premium-lede-aside">
            <p className="premium-roman">Enquire</p>
            <a href="/contact/" className="premium-link">
              Arrange a consultation →
            </a>
            <span className="num premium-lede-phone">
              <Phone width={14} height={14} className="premium-lede-phone-icon" aria-hidden />
              {' '}<a href={tel}>{phone}</a>
            </span>
            {bundle.response_time_promise && (
              <p className="premium-response-promise">{bundle.response_time_promise}</p>
            )}
            <CallNowBadge bundle={bundle} />
          </div>
        </ScrollReveal>

        <ScrollReveal as="section" className="premium-services" id="services">
          <div>
            <p className="premium-roman">{ROMAN[1]}. Practice</p>
            <h2 className="premium-h2">Our disciplines</h2>
          </div>
          <div className="premium-service-list">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={s.slug} className="premium-service-row">
                <span className="premium-service-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="premium-service-title">{s.title}</span>
                <span className="premium-service-blurb">{s.meta_description}</span>
                <span className="premium-service-arrow">→</span>
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* Quiet proof slab — renders only when a real review exists */}
        {review && (
          <ScrollReveal as="section" className="premium-proof-slab" aria-label="Client note">
            <blockquote className="premium-proof-quote">
              <p className="premium-proof-text">{review.text}</p>
              <footer className="premium-proof-attribution">
                {review.author}
                {/* locality is not a Review field — omit rather than fabricate */}
              </footer>
            </blockquote>
          </ScrollReveal>
        )}

        {bundle.photo_gallery.length > 0 && (
          <ScrollReveal as="section" className="premium-portfolio">
            <div>
              <p className="premium-roman">III. Portfolio</p>
              <h2 className="premium-h2">Selected work</h2>
            </div>
            <PhotoGallery bundle={bundle} variant="premium" />
          </ScrollReveal>
        )}

        <ScrollReveal as="section" className="premium-map" aria-label={`Map of ${bundle.city}, ${bundle.state}`}>
          <div>
            <p className="premium-roman">{ROMAN[1]}½. Place</p>
            <h2 className="premium-h2">{bundle.city}, {bundle.state}</h2>
          </div>
          <MapEmbed
            className="premium-map-frame"
            city={bundle.city}
            state={bundle.state}
            height={420}
          />
        </ScrollReveal>

        <ScrollReveal as="section" className="premium-areas" id="where">
          <div>
            <p className="premium-roman">{ROMAN[2]}. Where</p>
            <h2 className="premium-h2">Serving the {bundle.city} area</h2>
          </div>
          <ul className="premium-area-list">
            {areas.map((c) => {
              const slug = areaMap.get(c);
              return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
            })}
          </ul>
        </ScrollReveal>

        <ReviewsSection bundle={bundle} variant="premium" title="Client notes" />

        {faqs.length > 0 && (
          <ScrollReveal as="section" className="premium-faq" aria-label="Frequently asked questions">
            <div>
              <p className="premium-roman">{ROMAN[3]}. Inquiry</p>
              <h2 className="premium-h2">Questions, answered</h2>
            </div>
            <div className="premium-faq-list">
              {faqs.map((f, i) => (
                <div key={i} className="premium-faq-item">
                  <p className="premium-faq-q">{f.q}</p>
                  <p className="premium-faq-a">{f.a}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        )}

        {bundle.info_pages.length > 0 && (
          <ScrollReveal as="section" className="premium-learn-more" aria-label="Resources">
            <p className="premium-roman">{ROMAN[4]}. Reading</p>
            <h2 className="premium-h2">Notes from the studio</h2>
            <ul className="premium-learn-list">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="premium-learn-title">{p.title}</span>
                    <span className="premium-service-arrow">→</span>
                    <span className="premium-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        {blogTeasers.length > 0 && (
          <ScrollReveal as="section" className="premium-learn-more" aria-label="From the blog">
            <p className="premium-roman">{ROMAN[4]}½. Field notes</p>
            <h2 className="premium-h2">Recent writing</h2>
            <ul className="premium-learn-list">
              {blogTeasers.map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="premium-learn-title">{p.title}</span>
                    <span className="premium-service-arrow">→</span>
                    <span className="premium-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollReveal>
        )}

        <ScrollReveal as="section" className="premium-form-section" id="contact">
          <div>
            <p className="premium-roman">{ROMAN[5]}. Inquire</p>
            <h2 className="premium-h2">Begin a conversation</h2>
            <p className="premium-form-sub">
              Consultations are by arrangement. Share a few details and we will follow up at your convenience.
            </p>
          </div>
          <div className="premium-form-wrap">
            <LeadForm
              variant="premium"
              submit="Send a note →"
              source="home-premium"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </ScrollReveal>

        <ScrollReveal as="section" className="premium-cta">
          <p className="premium-cta-eyebrow">Arrange a visit</p>
          <h2 className="premium-cta-h2">Initial consultations are by appointment.</h2>
          <a href={tel} className="premium-cta-phone num">
            <Phone width={18} height={18} className="premium-cta-phone-icon" aria-hidden />
            {' '}{phone}
          </a>
          <CallNowBadge bundle={bundle} />
        </ScrollReveal>

        <footer className="premium-footer">
          <TrustStrip bundle={bundle} variant="premium" style="inline" />
          <div>
            © {new Date().getFullYear()} {bundle.business_name} · Licensed & insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
        </footer>

        <div className="sticky-mobile-bar surface-inverse">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            <Phone width={16} height={16} className="sticky-phone-icon" aria-hidden />
            {' '}{phone}
          </a>
          <a href="/contact/" className="cta">
            Enquire
          </a>
        </div>
        <div className="premium-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}
