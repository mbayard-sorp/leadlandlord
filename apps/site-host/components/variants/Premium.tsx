import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { heroH1, telHref, titleCaseKeyword } from '../../lib/content';
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
  const areas = uniq([
    bundle.city,
    ...bundle.nearby_cities,
    ...bundle.service_areas.map((a) => a.title),
  ]).slice(0, 8);
  const areaSlugByTitle = new Map(bundle.service_areas.map((a) => [a.title, a.slug]));
  const faqs = bundle.blog_posts
    .filter((p) => /\?$/.test(p.title))
    .slice(0, 6)
    .map((p) => ({ q: p.title, a: p.meta_description }));
  const blogTeasers = bundle.blog_posts.filter((p) => !/\?$/.test(p.title)).slice(0, 6);

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
          <span className="num">By appointment · ☎ {phone}</span>
        </div>

        <header className="premium-header">
          <a href="/" className="premium-brand">
            {bundle.business_name}
          </a>
          {/* SiteNav replaces the former inline .premium-nav; retains same CSS class */}
          <SiteNav bundle={bundle} variant="premium" className="premium-nav" />
        </header>

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
              sizes="(max-width: 768px) 100vw, 1200px"
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
              {/* ADR 0002: promoted from h2 to h1; sr-only h1 removed */}
              {/* SEO: render the exact targeted keyword phrase verbatim, title-cased. */}
              <h1 id="hero-h1" className="premium-h1">
                {titleCaseKeyword(heroH1(bundle))}
              </h1>
              {/* Trust line — license/insurance when fields present */}
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

        <section className="premium-lede-band" id="practice">
          <p className="premium-roman">{ROMAN[0]}. The Practice</p>
          <CertificationsRow bundle={bundle} variant="premium" />
          <p className="premium-lede">{bundle.home.meta_description}</p>
          <div className="premium-lede-aside">
            <p className="premium-roman">Begin</p>
            <a href="/contact/" className="premium-link">
              Request a visit →
            </a>
            <span className="num">
              ☎ <a href={tel}>{phone}</a>
            </span>
            <CallNowBadge bundle={bundle} />
          </div>
        </section>

        <section className="premium-services" id="services">
          <div>
            <p className="premium-roman">{ROMAN[1]}. Practice</p>
            <h2 className="premium-h2">What we do</h2>
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
        </section>

        {/* PhotoGallery — Portfolio section between Practice and Where */}
        {bundle.photo_gallery.length > 0 && (
          <section className="premium-portfolio">
            <div>
              <p className="premium-roman">III. Portfolio</p>
              <h2 className="premium-h2">Selected work</h2>
            </div>
            <PhotoGallery bundle={bundle} variant="premium" />
          </section>
        )}

        <section className="premium-map" aria-label={`Map of ${bundle.city}, ${bundle.state}`}>
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
        </section>

        <section className="premium-areas" id="where">
          <div>
            <p className="premium-roman">{ROMAN[2]}. Where</p>
            <h2 className="premium-h2">Serving the {bundle.city} area</h2>
          </div>
          <ul className="premium-area-list">
            {areas.map((c) => {
              const slug = areaSlugByTitle.get(c);
              return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
            })}
          </ul>
        </section>

        {/* ReviewsSection — CSS scroll-snap horizontal testimonial slider (between Where and Reading) */}
        <ReviewsSection bundle={bundle} variant="premium" title="Client notes" />

        {faqs.length > 0 && (
          <section className="premium-faq" aria-label="Frequently asked questions">
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
          </section>
        )}

        {bundle.info_pages.length > 0 && (
          <section className="premium-learn-more" aria-label="Resources">
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
          </section>
        )}

        {blogTeasers.length > 0 && (
          <section className="premium-learn-more" aria-label="From the blog">
            <p className="premium-roman">{ROMAN[4]}½. Field notes</p>
            <h2 className="premium-h2">Recent articles</h2>
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
          </section>
        )}

        <section className="premium-form-section" id="contact">
          <div>
            <p className="premium-roman">{ROMAN[5]}. Inquire</p>
            <h2 className="premium-h2">Begin a conversation</h2>
            <p className="premium-form-sub">
              Initial consultations are by appointment. Share a few details and we will be in touch.
            </p>
          </div>
          <div className="premium-form-wrap">
            <LeadForm
              variant="premium"
              submit="Send inquiry →"
              source="home-premium"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </section>

        <section className="premium-cta">
          <p className="premium-cta-eyebrow">Begin a project</p>
          <h2 className="premium-cta-h2">Initial consultations are by appointment.</h2>
          <a href={tel} className="premium-cta-phone num">
            ☎ {phone}
          </a>
          <CallNowBadge bundle={bundle} />
        </section>

        <footer className="premium-footer">
          <TrustStrip bundle={bundle} variant="premium" style="inline" />
          <div>
            © {new Date().getFullYear()} {bundle.business_name} · Licensed & insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
          <div className="premium-footer-disclaimer">
            This site connects callers with a partnered local provider.
          </div>
        </footer>

        <div className="sticky-mobile-bar surface-inverse">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            ☎ {phone}
          </a>
          <a href="/contact/" className="cta">
            Visit
          </a>
        </div>
        <div className="premium-mobile-spacer" aria-hidden />
      </div>
    </>
  );
}

function uniq<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
