import Image from 'next/image';
import { csImageUrl, type CsHeroBlock } from '@/lib/customsites-sanity';
import { HeroVideoBg } from './HeroVideoBg';

interface Props {
  block: CsHeroBlock;
  phone?: string | null;
}

/**
 * Split the heading around the emphasis phrase so it can be set in brass.
 * Matching is case-insensitive on the first occurrence; a phrase that is not in
 * the heading returns null and the headline renders in one color rather than
 * dropping text. The Studio field warns on that case so it does not pass unseen.
 */
function splitOnEmphasis(heading: string, emphasis?: string | null) {
  const needle = emphasis?.trim();
  if (!needle) return null;
  const at = heading.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;
  return {
    before: heading.slice(0, at),
    match: heading.slice(at, at + needle.length),
    after: heading.slice(at + needle.length),
  };
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
  const parts = splitOnEmphasis(block.heading, block.headingEmphasis);

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
          <h1>
            {parts ? (
              <>
                {parts.before}
                <span className="cs-hero-emphasis">{parts.match}</span>
                {parts.after}
              </>
            ) : (
              block.heading
            )}
          </h1>
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
