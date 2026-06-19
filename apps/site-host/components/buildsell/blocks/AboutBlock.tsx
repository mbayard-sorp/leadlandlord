import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';
import { ArrowRightIcon } from '../bs-svg';

interface AboutBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * About block layout per variant:
 * - split: image left / text right (or text only if no image)
 * - bold:  text left / image right, then a full-width dark stats band
 * - trust: narrow centered, NO image; stats render as credential pills
 *
 * Every image slot has a designed gradient empty-state — no variant ever
 * shows a blank box when imageUrl is absent.
 */

function AboutImagePlaceholder() {
  return (
    <div className="bs-about-image-placeholder" aria-hidden="true">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden="true">
        <circle cx="40" cy="28" r="14" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        <path d="M10 68 C10 50 70 50 70 68" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      </svg>
    </div>
  );
}

function AboutEyebrow({ section }: { section: BuildSellSection }) {
  if (!section.eyebrow) return null;
  return <p className="bs-section-eyebrow">{section.eyebrow}</p>;
}

function AboutCta({ section }: { section: BuildSellSection }) {
  const cta = section.cta;
  if (!cta?.href || !cta.label) return null;
  const ghost = cta.style === 'secondary' || cta.style === 'ghost';
  return (
    <a href={cta.href} className={`bs-btn ${ghost ? 'bs-btn-outline' : 'bs-btn-primary'} bs-about-cta`}>
      {cta.label}
      <ArrowRightIcon />
    </a>
  );
}

function StatBlocks({ stats }: { stats: NonNullable<BuildSellSection['stats']> }) {
  return (
    <div className="bs-stats-row">
      {stats.map((stat, i) => (
        <div key={i} className="bs-stat">
          <span className="bs-stat-value">{stat.value}</span>
          <span className="bs-stat-label">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

export function AboutBlock({ section, layoutVariant }: AboutBlockProps) {
  const stats = section.stats ?? [];
  const isTrust = layoutVariant === 'trust';
  const isBold = layoutVariant === 'bold';

  // trust: no image, narrow centered; stats become credential pills
  if (isTrust) {
    return (
      <section className="bs-section bs-reveal" id="about">
        <div className="bs-container">
          <div className="bs-about-trust">
            <AboutEyebrow section={section} />
            <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
            {section.body && (
              <p className="bs-about-body">{section.body}</p>
            )}
            {stats.length > 0 && (
              <div className="bs-credential-pills">
                {stats.map((stat, i) => (
                  <span key={i} className="bs-credential-pill">
                    <strong>{stat.value}</strong>
                    {stat.label}
                  </span>
                ))}
              </div>
            )}
            <AboutCta section={section} />
          </div>
        </div>
      </section>
    );
  }

  // bold: text left, image right — then a full-width dark stats band
  if (isBold) {
    return (
      <>
        <section className="bs-section bs-reveal" id="about">
          <div className="bs-container">
            <div className="bs-about-grid bs-about-grid--bold">
              {/* Text side */}
              <div>
                <AboutEyebrow section={section} />
                <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
                {section.body && (
                  <p className="bs-about-body">{section.body}</p>
                )}
                <AboutCta section={section} />
              </div>

              {/* Image side */}
              <div className="bs-about-image-wrap">
                {section.imageUrl ? (
                  <Image
                    src={section.imageUrl}
                    alt={section.heading ?? 'About our team'}
                    fill
                    sizes="(max-width: 767px) 100vw, 50vw"
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  <AboutImagePlaceholder />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Dedicated full-width dark stats band (designed bold treatment) */}
        {stats.length > 0 && (
          <section className="bs-stats-band bs-reveal" aria-label="By the numbers">
            <div className="bs-container">
              <div className="bs-stats-band-grid">
                {stats.map((stat, i) => (
                  <div key={i} className="bs-stats-band-item">
                    <span className="bs-stat-value bs-stats-band-value">{stat.value}</span>
                    <span className="bs-stats-band-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </>
    );
  }

  // split (default): image left, text right
  return (
    <section className="bs-section bs-reveal" id="about">
      <div className="bs-container">
        <div className="bs-about-grid bs-about-grid--split">
          {/* Image side — left */}
          <div className="bs-about-image-wrap">
            {section.imageUrl ? (
              <Image
                src={section.imageUrl}
                alt={section.heading ?? 'About our team'}
                fill
                sizes="(max-width: 767px) 100vw, 50vw"
                style={{ objectFit: 'cover' }}
              />
            ) : (
              <AboutImagePlaceholder />
            )}
          </div>

          {/* Text side — right */}
          <div>
            <AboutEyebrow section={section} />
            <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
            {section.body && (
              <p className="bs-about-body">{section.body}</p>
            )}
            {stats.length > 0 && <StatBlocks stats={stats} />}
            <AboutCta section={section} />
          </div>
        </div>
      </div>
    </section>
  );
}
