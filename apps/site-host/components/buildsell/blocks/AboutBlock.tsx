import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';

interface AboutBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * About block layout per variant:
 * - split: image left / text right (or text only if no image)
 * - bold:  text left / image right — swapped order for visual variety
 * - trust: narrow centered, NO image (text/stats only for clean credibility read)
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

export function AboutBlock({ section, layoutVariant }: AboutBlockProps) {
  const stats = section.stats ?? [];
  const isTrust = layoutVariant === 'trust';
  const isBold = layoutVariant === 'bold';

  // trust: no image, narrow centered
  if (isTrust) {
    return (
      <section className="bs-section bs-reveal" id="about">
        <div className="bs-container">
          <div className="bs-about-trust">
            <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
            {section.body && (
              <p className="bs-about-body">{section.body}</p>
            )}
            {stats.length > 0 && (
              <div className="bs-stats-row">
                {stats.map((stat, i) => (
                  <div key={i} className="bs-stat">
                    <span className="bs-stat-value">{stat.value}</span>
                    <span className="bs-stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // bold: text left, image right
  if (isBold) {
    return (
      <section className="bs-section bs-reveal" id="about">
        <div className="bs-container">
          <div className="bs-about-grid bs-about-grid--bold">
            {/* Text side */}
            <div>
              <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
              {section.body && (
                <p className="bs-about-body">{section.body}</p>
              )}
              {stats.length > 0 && (
                <div className="bs-stats-row">
                  {stats.map((stat, i) => (
                    <div key={i} className="bs-stat">
                      <span className="bs-stat-value">{stat.value}</span>
                      <span className="bs-stat-label">{stat.label}</span>
                    </div>
                  ))}
                </div>
              )}
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
            <h2 className="bs-section-title">{section.heading ?? 'About Us'}</h2>
            {section.body && (
              <p className="bs-about-body">{section.body}</p>
            )}
            {stats.length > 0 && (
              <div className="bs-stats-row">
                {stats.map((stat, i) => (
                  <div key={i} className="bs-stat">
                    <span className="bs-stat-value">{stat.value}</span>
                    <span className="bs-stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
