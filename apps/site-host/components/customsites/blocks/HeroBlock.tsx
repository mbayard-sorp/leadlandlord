import Image from 'next/image';
import { csImageUrl, type CsHeroBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsHeroBlock;
  phone?: string | null;
}

/** Full-bleed navy hero with an optional background image + overlay. */
export function HeroBlock({ block, phone }: Props) {
  const ctaHref = block.ctaHref?.trim() || (phone ? `tel:${phone}` : '/contact');
  const ctaLabel = block.ctaLabel?.trim() || (phone ? `Call ${phone}` : 'Contact Us');

  return (
    <section className="cs-hero" id="home">
      {block.backgroundImageUrl ? (
        <div className="cs-hero-bg">
          <Image
            src={csImageUrl(block.backgroundImageUrl, { w: 2048 })}
            alt={block.backgroundImageAlt ?? ''}
            fill
            priority
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
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
