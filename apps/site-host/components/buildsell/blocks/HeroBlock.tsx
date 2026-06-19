import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';

interface HeroBlockProps {
  section: BuildSellSection;
  phone?: string | null;
  layoutVariant: 'split' | 'bold' | 'trust';
}

export function HeroBlock({ section, phone, layoutVariant }: HeroBlockProps) {
  const stars = '★★★★★';
  const isBold = layoutVariant === 'bold';

  const headline = section.headline ?? '[Headline — Replace]';
  const highlightText = section.highlight;
  const parts = highlightText ? headline.split(highlightText) : null;

  return (
    <section className="bs-hero" id="home">
      {/* Bold variant: image as background */}
      {isBold && section.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={section.imageUrl}
          alt={headline}
          className="bs-hero-bg-image"
        />
      )}

      <div className="bs-container">
        <div className="bs-hero-inner">
          {/* Text column */}
          <div>
            {section.eyebrow && (
              <span className="bs-hero-eyebrow">{section.eyebrow}</span>
            )}

            <h1 className="bs-hero-headline">
              {parts && highlightText ? (
                <>
                  {parts[0]}
                  <span className="bs-hero-highlight">{highlightText}</span>
                  {parts[1]}
                </>
              ) : (
                headline
              )}
            </h1>

            {section.subhead && (
              <p className="bs-hero-subhead">{section.subhead}</p>
            )}

            <div className="bs-hero-actions">
              {phone && (
                <a href={`tel:${phone}`} className="bs-btn bs-btn-primary bs-btn-lg">
                  Call {phone}
                </a>
              )}
              {section.primaryCta?.href && section.primaryCta.href !== '#' && (
                <a
                  href={section.primaryCta.href}
                  className="bs-btn bs-btn-primary bs-btn-lg"
                >
                  {section.primaryCta.label ?? 'Get a Free Quote'}
                </a>
              )}
              {!phone && !section.primaryCta?.href && (
                <a href="#contact" className="bs-btn bs-btn-primary bs-btn-lg">
                  {section.primaryCta?.label ?? 'Get a Free Quote'}
                </a>
              )}
              {section.secondaryCta?.href && (
                <a href={section.secondaryCta.href} className="bs-btn bs-btn-outline bs-btn-lg">
                  {section.secondaryCta.label ?? 'Learn More'}
                </a>
              )}
            </div>

            {section.showRating && (
              <div className="bs-rating" style={{ marginTop: '1.25rem' }}>
                <span aria-hidden="true">{stars}</span>
                <span className="bs-rating-label">5.0 · Top-rated local service</span>
              </div>
            )}

            {section.badges && section.badges.length > 0 && (
              <div className="bs-badges">
                {section.badges.map((badge, i) => (
                  <span key={i} className="bs-badge">
                    {badge.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Image column — split and trust variants only */}
          {!isBold && (
            <div className="bs-hero-image">
              {section.imageUrl ? (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <Image
                    src={section.imageUrl}
                    alt={`${headline} hero image`}
                    fill
                    priority
                    sizes="(max-width: 767px) 100vw, 50vw"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
              ) : (
                <div className="bs-hero-image-placeholder" style={{ height: '100%' }}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
