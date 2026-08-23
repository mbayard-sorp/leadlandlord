import Image from 'next/image';
import { csImageUrl, type CsHeroBlock } from '@/lib/customsites-sanity';
import { HeroVideoBg } from './HeroVideoBg';

interface Props {
  block: CsHeroBlock;
  phone?: string | null;
}

/**
 * Full-bleed navy hero with an optional background image + overlay.
 *
 * A background video, when present, layers over the image: the image is the
 * poster/fallback and stays visible until the loop paints, so the hero never
 * renders naked while the video buffers.
 */
export function HeroBlock({ block, phone }: Props) {
  const ctaHref = block.ctaHref?.trim() || (phone ? `tel:${phone}` : '/contact');
  const ctaLabel = block.ctaLabel?.trim() || (phone ? `Call ${phone}` : 'Contact Us');
  const hasBg = Boolean(block.backgroundImageUrl || block.backgroundVideoUrl);

  return (
    <section className="cs-hero" id="home">
      {hasBg ? (
        <div className="cs-hero-bg">
          {block.backgroundImageUrl ? (
            <Image
              src={csImageUrl(block.backgroundImageUrl, { w: 2048 })}
              alt={block.backgroundImageAlt ?? ''}
              fill
              priority
              sizes="100vw"
              style={{ objectFit: 'cover' }}
            />
          ) : null}
          {block.backgroundVideoUrl ? (
            <HeroVideoBg src={block.backgroundVideoUrl} type={block.backgroundVideoMimeType} />
          ) : null}
        </div>
      ) : null}
      <div className="cs-container cs-section" style={{ position: 'relative', zIndex: 1 }}>
        <div className="cs-hero-inner">
          {block.eyebrow ? <span className="cs-eyebrow cs-eyebrow--inverse">{block.eyebrow}</span> : null}
          <h1>{block.heading}</h1>
          {block.subheading ? <p className="cs-hero-subheading">{block.subheading}</p> : null}
          <div className="cs-hero-cta">
            <a href={ctaHref} className="cs-btn cs-btn-primary">
              {ctaLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
