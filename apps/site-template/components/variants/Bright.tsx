import type { Bundle } from '../../lib/content';
import { telHref, trackingNumber } from '../../lib/content';
import { LocalBusinessJsonLd, FaqJsonLd } from '../shared/LocalBusinessJsonLd';

interface Props {
  bundle: Bundle;
  /** Absolute URL of the page, used for canonical + JSON-LD. */
  pageUrl?: string;
}

const SERVICE_BG = ['bg-coral', 'bg-sun', 'bg-mint', 'bg-sky'] as const;
const SERVICE_ICONS = ['🏡', '✦', '⌂', '◐', '☘', '◇'];

/**
 * Variant D — Bright Approachable.
 * Bricolage 700 + Plus Jakarta Sans. Cream + coral. Rotating pastel cards,
 * squiggle SVG underline on hero keyword, sticky-note callout, dashed dividers.
 * For cleaning, junk removal, pest, lawn care, dog walking, mobile detail.
 */
export function BrightHome({ bundle, pageUrl = 'https://example.com' }: Props) {
  const phone = trackingNumber();
  const tel = telHref(phone);
  const trust =
    bundle.trust_signals.length > 0
      ? bundle.trust_signals
      : ['Bonded', 'Insured', 'Same person every visit'];
  const areas = uniq([
    bundle.city,
    ...bundle.nearby_cities,
    ...bundle.service_areas.map((a) => a.title),
  ]).slice(0, 10);
  const initials = bundle.business_name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toLowerCase();
  const literalH1 = `${cap(bundle.niche)} in ${bundle.city}, ${bundle.state}`;

  // Pull FAQ from blog posts shaped as questions.
  const faqs = bundle.blog_posts
    .filter((p) => /\?$/.test(p.title))
    .slice(0, 5)
    .map((p) => ({ q: p.title, a: p.meta_description }));

  // Underline the niche keyword in the hero headline with the squiggle.
  const renderHeroH1 = () => {
    const title = bundle.home.title;
    const keyword = bundle.niche;
    const idx = title.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx < 0) {
      return title;
    }
    const before = title.slice(0, idx);
    const match = title.slice(idx, idx + keyword.length);
    const after = title.slice(idx + keyword.length);
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

      <h1 className="sr-only">{literalH1}</h1>

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
            <a href={tel} className="bright-phone-pill num">
              ☎ {phone}
            </a>
            <a href="#contact" className="bright-cta-pill">
              Book online ✦
            </a>
          </div>
        </header>

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
              <h2 id="hero-h1" className="bright-h1">
                {renderHeroH1()}
              </h2>
              <p className="bright-lede">{bundle.home.meta_description}</p>
              <div className="bright-hero-buttons">
                <a href="#contact" className="bright-btn bright-btn-primary">
                  Book online ✦
                </a>
                <a href={tel} className="bright-btn bright-btn-secondary num">
                  ☎ {phone}
                </a>
              </div>
              <ul className="bright-trust">
                {trust.slice(0, 4).map((t, i) => (
                  <li key={t}>
                    {['★', '♥', '✿', '☻'][i % 4]} {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bright-hero-image-wrap">
              <div className="bright-hero-image">
                {bundle.hero_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={bundle.hero_image_url}
                    alt={`${bundle.niche} in ${bundle.city}, ${bundle.state}`}
                  />
                ) : (
                  <div className="bright-hero-placeholder">[hero]</div>
                )}
              </div>
              <div className="bright-sticky-note" aria-hidden>
                same friendly crew, every visit ♥
              </div>
            </div>
          </div>
        </section>

        <section className="bright-services" id="services">
          <div className="bright-section-head">
            <div>
              <p className="bright-eyebrow">What we do</p>
              <h2 className="bright-h2">Services</h2>
            </div>
            <span className="bright-section-aside">not sure? give us a ring →</span>
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
                    {SERVICE_ICONS[i % SERVICE_ICONS.length]}
                  </span>
                  <h3 className="bright-service-title">{s.title}</h3>
                </div>
                <p className="bright-service-blurb">{s.meta_description}</p>
                <span className="bright-service-link">See details →</span>
              </a>
            ))}
          </div>
        </section>

        <section className="bright-cta-row" id="contact">
          <div className="bright-cta-card">
            <h2 className="bright-cta-h2">Ready when you are.</h2>
            <p className="bright-cta-sub">
              Most weeks we have same-week openings. Book online or call — whichever's easier.
            </p>
            <div className="bright-hero-buttons" style={{ marginTop: 0 }}>
              <a href="/contact/" className="bright-btn bright-btn-secondary">
                Book online ✦
              </a>
              <a href={tel} className="bright-btn bright-btn-secondary num">
                ☎ {phone}
              </a>
            </div>
          </div>
          <div className="bright-areas-card">
            <h2 className="bright-h2">We come to —</h2>
            <ul className="bright-area-chips">
              {areas.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </section>

        {bundle.info_pages.length > 0 && (
          <section className="bright-learn-more" aria-label="Resources">
            <p className="bright-eyebrow">Learn more</p>
            <h2 className="bright-h2">Tips & guides</h2>
            <div className="bright-learn-grid">
              {bundle.info_pages.slice(0, 6).map((p) => (
                <a key={p.slug} href={p.slug} className="bright-learn-card">
                  <span className="bright-learn-title">{p.title}</span>
                  <span className="bright-learn-blurb">{p.meta_description}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <footer className="bright-footer">
          <div>
            © {new Date().getFullYear()} {bundle.business_name} · Bonded & insured
          </div>
          <div>{areas.slice(0, 6).join(' · ')}</div>
          <div className="bright-footer-disclaimer">
            This site connects callers with a partnered local provider.
          </div>
        </footer>

        <div className="sticky-mobile-bar">
          <a href={tel} className="phone num">
            ☎ {phone}
          </a>
          <a href="#contact" className="cta">
            Book
          </a>
        </div>
        <div className="bright-mobile-spacer" aria-hidden />
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
