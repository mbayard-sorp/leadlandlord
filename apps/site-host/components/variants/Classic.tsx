import Image from 'next/image';
import type { Bundle } from '../../lib/content';
import { telHref } from '../../lib/content';
import { LeadForm } from '../shared/LeadForm';
import { LocalBusinessJsonLd, FaqJsonLd } from '../shared/LocalBusinessJsonLd';
import { MapEmbed } from '../shared/MapEmbed';

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
 * Painted truck doors. Hardware-store flyer. Yellow-Pages-direct.
 * For HVAC, plumbing, electrical, gutter, roofing, fence, septic.
 *
 * Type: Oswald 700 uppercase display + Public Sans body.
 * Color: Ink #0F1620 + Paper #FBFAF6 + Accent safety-orange #E85D10.
 * Borders: 2px Ink, 2-4px radius. No shadows. No top-nav.
 */
export function ClassicHome({ bundle, phone, siteId, siteSlug, pageUrl = 'https://example.com' }: Props) {
  const tel = telHref(phone);
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Licensed & insured', 'Same-week service', 'Free quotes', 'We answer the phone'];
  const areas = uniq([bundle.city, ...bundle.nearby_cities, ...bundle.service_areas.map((a) => a.title)]).slice(0, 12);
  const areaSlugByTitle = new Map(bundle.service_areas.map((a) => [a.title, a.slug]));
  const faqs = bundle.blog_posts
    .filter((p) => /\?$/.test(p.title))
    .slice(0, 6)
    .map((p) => ({ q: p.title, a: p.meta_description }));
  const blogTeasers = bundle.blog_posts.filter((p) => !/\?$/.test(p.title)).slice(0, 6);
  const literalH1 = `${cap(bundle.niche)} in ${bundle.city}, ${bundle.state}`;

  return (
    <>
      <LocalBusinessJsonLd bundle={bundle} phone={phone} url={pageUrl} />
      <FaqJsonLd questions={faqs} />

      <h1 className="sr-only">{literalH1}</h1>

      <div className="classic-shell">
        {/* utility bar */}
        <div className="classic-utility surface-inverse">
          <span>★ Family-owned · {bundle.city}, {bundle.state}</span>
          <span className="hidden sm:inline">Open 7am – 9pm · 7 days</span>
        </div>

        {/* header — brand wordmark + phone pill, no nav */}
        <header className="classic-header">
          <a href="/" className="classic-brand">
            <span className="classic-mark" aria-hidden />
            <span className="classic-brand-name">{bundle.business_name}</span>
          </a>
          <a href={tel} className="classic-phone-pill num">☎ {phone}</a>
        </header>

        {/* hero */}
        <section className="classic-hero" aria-labelledby="hero-h1">
          <div className="classic-hero-text">
            <p className="classic-eyebrow">
              {bundle.city}, {bundle.state} · Family-owned
            </p>
            <h2 id="hero-h1" className="classic-h1">
              {bundle.niche.toUpperCase()}
              <br />
              IN {bundle.city.toUpperCase()},<br className="hidden sm:block" /> {bundle.state}.
            </h2>
            <div className="classic-hero-rule" aria-hidden />
            <p className="classic-lede">
              {bundle.home.meta_description}
            </p>
            <div className="classic-hero-buttons">
              <a href={tel} className="classic-btn classic-btn-primary">☎ Call {phone}</a>
              <a href="#contact" className="classic-btn classic-btn-secondary">Get free quote →</a>
            </div>
            <ul className="classic-hero-trust">
              {trust.slice(0, 3).map((t) => (
                <li key={t}>✓ {t}</li>
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
                sizes="(max-width: 768px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <div className="classic-hero-placeholder">[hero photo]</div>
            )}
          </div>
        </section>

        {/* BIG phone block */}
        <section className="classic-phone-block">
          <p className="classic-phone-eyebrow">We answer the phone.</p>
          <a href={tel} className="classic-phone-big num">{phone}</a>
          <p className="classic-phone-sub">Tap to call · 7am – 9pm, 7 days · free quotes</p>
        </section>

        {/* trust strip on dark */}
        <section className="classic-trust-strip surface-inverse" aria-label="Trust signals">
          {trust.slice(0, 4).map((t, i) => (
            <div key={t}>
              <div className="classic-trust-eyebrow">{['Licensed & insured', 'Same-week service', 'Free quotes', 'We answer'][i] ?? t}</div>
              <div className="classic-trust-detail">{t}</div>
            </div>
          ))}
        </section>

        {/* numbered services */}
        <section className="classic-services" id="services">
          <header className="classic-section-head">
            <p className="classic-section-eyebrow">What we do</p>
            <h2 className="classic-h2">Services</h2>
          </header>
          <div className="classic-services-grid">
            {bundle.services.map((s, i) => (
              <a key={s.slug} href={s.slug} className="classic-service-tile">
                <div className="classic-service-num num">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="classic-service-title">{s.title}</h3>
                <p className="classic-service-blurb">{s.meta_description}</p>
                <span className="classic-service-link">READ MORE →</span>
              </a>
            ))}
          </div>
        </section>

        {/* service areas */}
        <section className="classic-areas">
          <p className="classic-section-eyebrow">Where we work</p>
          <h2 className="classic-h2">{bundle.city} & nearby towns</h2>
          <ul className="classic-area-chips">
            {areas.map((c) => {
              const slug = areaSlugByTitle.get(c);
              return <li key={c}>{slug ? <a href={slug}>{c}</a> : c}</li>;
            })}
          </ul>
          <MapEmbed
            className="classic-map-frame"
            city={bundle.city}
            state={bundle.state}
            height={320}
          />
        </section>

        {/* FAQ */}
        {faqs.length > 0 && (
          <section className="classic-faq" aria-label="FAQ">
            <p className="classic-section-eyebrow">Common questions</p>
            <h2 className="classic-h2">Questions our customers ask</h2>
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
          </section>
        )}

        {/* Learn more — links to /pages/[slug] */}
        {bundle.info_pages.length > 0 && (
          <section className="classic-learn-more" aria-label="Resources">
            <p className="classic-section-eyebrow">Learn more</p>
            <h2 className="classic-h2">Local guides & info</h2>
            <ul className="classic-learn-list">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="classic-learn-title">{p.title}</span>
                    <span className="classic-learn-arrow">→</span>
                    <span className="classic-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* From the blog — links to /blog/[slug] */}
        {blogTeasers.length > 0 && (
          <section className="classic-learn-more" aria-label="From the blog">
            <p className="classic-section-eyebrow">From the blog</p>
            <h2 className="classic-h2">Recent articles</h2>
            <ul className="classic-learn-list">
              {blogTeasers.map((p) => (
                <li key={p.slug}>
                  <a href={p.slug}>
                    <span className="classic-learn-title">{p.title}</span>
                    <span className="classic-learn-arrow">→</span>
                    <span className="classic-learn-blurb">{p.meta_description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* contact + form */}
        <section className="classic-contact" id="contact">
          <div className="classic-contact-info surface-inverse">
            <p className="classic-section-eyebrow" data-accent>Get in touch</p>
            <h2 className="classic-h2">Call us — we pick up.</h2>
            <a href={tel} className="classic-phone-block-inline num" data-accent>{phone}</a>
            <p>Open 7am – 9pm, 7 days a week.</p>
            <p className="classic-contact-areas">
              Serving {areas.slice(0, 6).join(' · ')}
            </p>
          </div>
          <div className="classic-contact-form">
            <LeadForm
              variant="classic"
              heading="Get a free quote"
              sub="Or just call — we pick up."
              submit="SEND →"
              siteId={siteId}
              siteSlug={siteSlug}
            />
          </div>
        </section>

        {/* footer */}
        <footer className="classic-footer surface-inverse">
          <div>© {new Date().getFullYear()} {bundle.business_name} · Licensed & insured · [LICENSE #]</div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
          <div className="classic-footer-disclaimer">
            This site connects callers with a partnered local provider.
          </div>
        </footer>

        {/* sticky mobile bar */}
        <div className="sticky-mobile-bar surface-inverse" aria-hidden="false">
          <a href={tel} className="phone num">☎ {phone}</a>
          <a href="#contact" className="cta">Get quote</a>
        </div>
        <div className="classic-mobile-spacer" aria-hidden />
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
