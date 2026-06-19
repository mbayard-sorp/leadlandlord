import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';
import { Icon } from '../Icon';
import { Stars, ArrowRightIcon } from '../bs-svg';

interface HeroBlockProps {
  section: BuildSellSection;
  phone?: string | null;
  layoutVariant: 'split' | 'bold' | 'trust';
  reviewCount?: number | null;
  rating?: number | null;
}

/**
 * Designed empty-state: gradient panel with a subtle tool/trade icon SVG.
 * Used whenever imageUrl is absent so no variant ever shows a blank box.
 */
function ImagePlaceholder({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`bs-hero-image-placeholder ${className ?? ''}`} style={style} aria-hidden="true">
      <svg width="72" height="72" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="currentColor" opacity="0.12" />
        <path
          d="M20 44 L26 38 M38 26 L44 20 M26 38 L38 26 M20 44 C18 46 18 46 20 44Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect x="36" y="14" width="14" height="6" rx="2" transform="rotate(45 36 14)" fill="currentColor" opacity="0.5" />
      </svg>
    </div>
  );
}

export function HeroBlock({ section, phone, layoutVariant, reviewCount, rating }: HeroBlockProps) {
  const isBold = layoutVariant === 'bold';
  const isTrust = layoutVariant === 'trust';

  const headline = section.headline ?? '[Headline — Replace]';
  const highlightText = section.highlight;
  const parts = highlightText ? headline.split(highlightText) : null;

  const ratingDisplay = rating ?? 5;
  const reviewLabel = reviewCount ? `${reviewCount.toLocaleString()} reviews` : 'Top-rated local service';

  function HeadlineNode() {
    return (
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
    );
  }

  function ActionRow() {
    return (
      <div className="bs-hero-actions">
        {phone ? (
          <a href={`tel:${phone}`} className="bs-btn bs-btn-primary bs-btn-lg">
            Call {phone}
            <ArrowRightIcon />
          </a>
        ) : (
          <a href="#contact" className="bs-btn bs-btn-primary bs-btn-lg">
            {section.primaryCta?.label ?? 'Get a Free Quote'}
            <ArrowRightIcon />
          </a>
        )}
        {section.secondaryCta?.href && (
          <a href={section.secondaryCta.href} className="bs-btn bs-btn-outline bs-btn-lg">
            {section.secondaryCta.label ?? 'Learn More'}
          </a>
        )}
      </div>
    );
  }

  function RatingBadge({ pill }: { pill?: boolean }) {
    if (!section.showRating) return null;
    return (
      <div className={`bs-rating bs-hero-rating${pill ? ' bs-hero-rating--pill' : ''}`}>
        <Stars rating={ratingDisplay} size={pill ? 18 : 16} />
        <span className="bs-rating-label">
          {ratingDisplay.toFixed(1)} · {reviewLabel}
        </span>
      </div>
    );
  }

  function BadgeRow() {
    if (!section.badges || section.badges.length === 0) return null;
    return (
      <div className="bs-badges">
        {section.badges.map((badge, i) => (
          <span key={i} className="bs-badge">
            {badge.icon && <Icon name={badge.icon} size={15} />}
            {badge.label}
          </span>
        ))}
      </div>
    );
  }

  // ---- BOLD variant: full-width dark hero + overlapping trust strip ----
  if (isBold) {
    const trustBadges = (section.badges ?? []).slice(0, 4);
    return (
      <>
        <section className="bs-hero bs-reveal" id="home">
          {/* Background image (next/image fill) or gradient empty-state */}
          <div className="bs-hero-bold-bg" aria-hidden="true">
            {section.imageUrl ? (
              <Image
                src={section.imageUrl}
                alt=""
                fill
                priority
                sizes="100vw"
                style={{ objectFit: 'cover', opacity: 0.45 }}
              />
            ) : (
              <div className="bs-hero-bold-bg-gradient" />
            )}
          </div>

          <div className="bs-container">
            <div className="bs-hero-inner">
              {section.eyebrow && (
                <span className="bs-hero-eyebrow">{section.eyebrow}</span>
              )}
              <HeadlineNode />
              {section.subhead && (
                <p className="bs-hero-subhead">{section.subhead}</p>
              )}
              <RatingBadge />
              <ActionRow />
              <BadgeRow />
            </div>
          </div>
        </section>

        {/* Overlapping trust strip: elevated surface cards pulled up over the
            next section's top edge (designed -42px overlap). */}
        {trustBadges.length > 0 && (
          <div className="bs-container">
            <div className="bs-bold-trust-strip">
              {trustBadges.map((badge, i) => (
                <div key={i} className="bs-bold-trust-card">
                  {badge.icon && (
                    <span className="bs-bold-trust-icon" aria-hidden="true">
                      <Icon name={badge.icon} size={20} />
                    </span>
                  )}
                  <span className="bs-bold-trust-label">{badge.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  // ---- TRUST variant: rating leads, centered, then a wide 3-image strip ----
  if (isTrust) {
    return (
      <section className="bs-hero bs-reveal" id="home">
        <div className="bs-container">
          <div className="bs-hero-inner">
            {/* Rating IS the hero — prominent pill on top. */}
            <RatingBadge pill />
            {section.eyebrow && (
              <span className="bs-hero-eyebrow">{section.eyebrow}</span>
            )}
            <HeadlineNode />
            {section.subhead && (
              <p className="bs-hero-subhead">{section.subhead}</p>
            )}
            <BadgeRow />
            <ActionRow />
          </div>

          {/* 3-image strip — each tile uses its own image when present (auto-filled
              from the hero prompt by the builder / operator), else a gradient. */}
          <div className="bs-hero-trust-strip">
            {[
              { url: section.imageUrl, gradient: 'bs-hero-trust-tile--gradient-a' },
              { url: section.imageUrlB, gradient: 'bs-hero-trust-tile--gradient-b' },
              { url: section.imageUrlC, gradient: 'bs-hero-trust-tile--gradient-c' },
            ].map((tile, i) =>
              tile.url ? (
                <div key={i} className="bs-hero-trust-tile" style={{ position: 'relative' }}>
                  <Image
                    src={tile.url}
                    alt={i === 0 ? headline : ''}
                    fill
                    priority={i === 0}
                    sizes="(max-width: 767px) 100vw, 33vw"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
              ) : (
                <div key={i} className={`bs-hero-trust-tile ${tile.gradient}`} aria-hidden="true" />
              ),
            )}
          </div>
        </div>
      </section>
    );
  }

  // ---- SPLIT variant (default): text left, floating image card right ----
  return (
    <section className="bs-hero bs-reveal" id="home">
      <div className="bs-container">
        <div className="bs-hero-inner">
          {/* Text column */}
          <div>
            {section.eyebrow && (
              <span className="bs-hero-eyebrow">{section.eyebrow}</span>
            )}
            <HeadlineNode />
            {section.subhead && (
              <p className="bs-hero-subhead">{section.subhead}</p>
            )}
            <RatingBadge />
            <ActionRow />
            <BadgeRow />
          </div>

          {/* Floating image card column */}
          <div className="bs-hero-image">
            {section.imageUrl ? (
              <>
                {/* Clipped frame: rounds the image corners without clipping
                    the float cards, which intentionally overhang the edges. */}
                <div className="bs-hero-image-frame">
                  <Image
                    src={section.imageUrl}
                    alt={`${headline} hero image`}
                    fill
                    priority
                    sizes="(max-width: 767px) 100vw, 50vw"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
                {/* Floating credibility cards overlaid on the image */}
                {section.showRating && (
                  <div className="bs-hero-float-card bs-hero-float-card--top" aria-hidden="true">
                    <Stars rating={ratingDisplay} size={14} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--bs-text)' }}>
                      {ratingDisplay.toFixed(1)} · {reviewLabel}
                    </span>
                  </div>
                )}
                {section.badges && section.badges[0] && (
                  <div className="bs-hero-float-card bs-hero-float-card--bottom" aria-hidden="true">
                    {section.badges[0].icon && <Icon name={section.badges[0].icon} size={16} />}
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--bs-text)' }}>
                      {section.badges[0].label}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <ImagePlaceholder style={{ height: '100%' }} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
