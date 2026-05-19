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

const SERVICE_ICONS = ['◉', '▦', '⌁', '◈', '◐', '◇', '✦', '◆'];

/**
 * Variant B — Clean Modern.
 * Bricolage Grotesque + DM Sans, deep aqua, geometric SVG hero, soft-shadow
 * cards, FAQ accordion. For solar / EV / smart-home / water-heater install.
 */
export function ModernHome({ bundle, phone, siteId, siteSlug, pageUrl = 'https://example.com' }: Props) {
  const tel = telHref(phone);
  const baseUrl = pageUrl.replace(/\/$/, '');
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Licensed & insured', 'Free quote in 24h', 'Federal tax credit help'];
  const areas = uniq([
    bundle.city,
    ...bundle.nearby_cities,
    ...bundle.service_areas.map((a) => a.title),
  ]).slice(0, 12);
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

      <div className="modern-shell">
        <header className="modern-header">
          <a href="/" className="modern-brand">
            <span className="modern-mark" aria-hidden />
            <span className="modern-brand-name">{bundle.business_name}</span>
          </a>
          <div className="modern-header-cta">
            <a href={tel} className="modern-phone-pill num">
              ☎ {phone}
            </a>
            <CallNowBadge bundle={bundle} />
            <a href="#contact" className="modern-cta-pill">
              Get quote
            </a>
          </div>
        </header>

        {/* top nav — inserted immediately after header */}
        <SiteNav bundle={bundle} variant="modern" />

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
              {/* ADR 0002: promoted from h2 to h1; sr-only h1 removed */}
              {/* SEO: render the exact targeted keyword phrase, title-cased. */}
              <h1 id="hero-h1" className="modern-h1">
                {titleCaseKeyword(heroH1(bundle))}
              </h1>
              <p className="modern-lede">{bundle.home.meta_description}</p>
              <div className="modern-hero-buttons">
                <a href="#contact" className="modern-btn modern-btn-primary">
                  Get free quote →
                </a>
                <a href={tel} className="modern-btn modern-btn-secondary num">
                  ☎ {phone}
                </a>
              </div>
              <ul className="modern-trust">
                {trust.slice(0, 4).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>

            <div className="modern-form-card">
              <p className="modern-form-card-eyebrow">Free quote</p>
              <h3 className="modern-form-card-h2">Same business day reply</h3>
              <p className="modern-form-card-sub">
                Drop your details — no spam, no robocalls.
              </p>
              <LeadForm variant="modern" submit="Get quote →" source="hero" siteId={siteId} siteSlug={siteSlug} />
            </div>
          </div>
        </section>

        {/* trust band — light surface, paper-2 */}
        <section className="modern-trust-band" aria-label="Trust signals">
          {trust.slice(0, 4).map((t) => (
            <div key={t} className="modern-trust-band-item">{t}</div>
          ))}
        </section>

        {/* TrustStrip (counters) — below hero/trust band */}
        <TrustStrip bundle={bundle} variant="modern" />

        <section className="modern-services" id="services">
          <header className="modern-section-head">
            <p className="modern-eyebrow">What we install</p>
            <h2 className="modern-h2">Services</h2>
          </header>
          <div className="modern-services-grid">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={s.slug} className="modern-service-card">
                <span className="modern-service-icon" aria-hidden>
                  {SERVICE_ICONS[i % SERVICE_ICONS.length]}
                </span>
                <h3 className="modern-service-title">{s.title}</h3>
                <p className="modern-service-blurb">{s.meta_description}</p>
                <span className="modern-service-link">Learn more →</span>
              </a>
            ))}
          </div>
        </section>

        {/* ReviewsSection — grid between services and FAQ/areas */}
        <ReviewsSection bundle={bundle} variant="modern" />

        {/* PhotoGallery — below ReviewsSection */}
        <PhotoGallery bundle={bundle} variant="modern" />

        {/* BIG phone block */}
        <section className="modern-phone-block">
          <p className="modern-phone-block-eyebrow">{bundle.niche} specialists</p>
          <a href={tel} className="modern-phone-block-num num">{phone}</a>
          <CallNowBadge bundle={bundle} />
          <p className="modern-phone-block-sub">Tap to call · same-day response · free quotes</p>
        </section>

        {(faqs.length > 0 || areas.length > 0) && (
          <section className="modern-faq-areas" id="where">
            <div className="modern-faq">
              <p className="modern-eyebrow">Common questions</p>
              <h2 className="modern-h2">FAQ</h2>
              {faqs.length === 0 ? (
                <p className="modern-lede" style={{ marginTop: 16 }}>
                  Have a question? Just call — we'll answer it on the spot.
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
              <p className="modern-eyebrow">Service areas</p>
              <h2 className="modern-h2">Where we work</h2>
              <ul className="modern-area-chips">
                {areas.map((c) => {
                  const slug = areaSlugByTitle.get(c);
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
          </section>
        )}

        {/* fallback #where anchor when the combined section is absent */}
        {faqs.length === 0 && areas.length === 0 && (
          <span id="where" aria-hidden style={{ display: 'none' }} />
        )}

        {bundle.info_pages.length > 0 && (
          <section className="modern-learn-more" aria-label="Resources">
            <p className="modern-eyebrow">Learn more</p>
            <h2 className="modern-h2">Local guides</h2>
            <div className="modern-learn-grid">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <a key={p.slug} href={p.slug} className="modern-learn-card">
                  <span className="modern-learn-title">{p.title}</span>
                  <span className="modern-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {blogTeasers.length > 0 && (
          <section className="modern-learn-more" aria-label="From the blog">
            <p className="modern-eyebrow">From the blog</p>
            <h2 className="modern-h2">Recent articles</h2>
            <div className="modern-learn-grid">
              {blogTeasers.map((p) => (
                <a key={p.slug} href={p.slug} className="modern-learn-card">
                  <span className="modern-learn-title">{p.title}</span>
                  <span className="modern-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* CertificationsRow + GuaranteesList in footer-adjacent block */}
        <div className="modern-trust-footer-block">
          <CertificationsRow bundle={bundle} variant="modern" />
          <GuaranteesList bundle={bundle} />
        </div>

        <section className="modern-cta" id="contact">
          <h2 className="modern-cta-h2">Ready for a quote?</h2>
          <p className="modern-cta-sub">15-min phone call, no pressure.</p>
          <a href={tel} className="modern-cta-phone num">
            ☎ {phone}
          </a>
          <CallNowBadge bundle={bundle} />
        </section>

        <footer className="modern-footer surface-inverse">
          <div>
            © {new Date().getFullYear()} {bundle.business_name} · Licensed & insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
        </footer>

        <div className="sticky-mobile-bar surface-inverse">
          <a href={tel} className="phone num" aria-label={`Call ${phone}`}>
            ☎ {phone}
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

function uniq<T>(arr: T[]): T[] {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
