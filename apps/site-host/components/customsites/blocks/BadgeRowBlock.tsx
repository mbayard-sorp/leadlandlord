import Image from 'next/image';
import type { CsBadgeRowBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsBadgeRowBlock;
}

/** Grayscale affiliation/award logos, color on hover (see .cs-badge-row in adr.css). */
export function BadgeRowBlock({ block }: Props) {
  const badges = block.badges ?? [];
  if (badges.length === 0) return null;

  return (
    <section className="cs-section cs-badge-section">
      <div className="cs-container cs-badge-row">
        {badges.map((badge) => {
          const img = badge.imageUrl ? (
            <span className="cs-badge-img">
              <Image
                src={badge.imageUrl}
                alt={badge.imageAlt ?? badge.name}
                fill
                sizes="220px"
                style={{ objectFit: 'contain' }}
              />
            </span>
          ) : null;
          return badge.url ? (
            <a key={badge._id} href={badge.url} target="_blank" rel="noopener noreferrer" className="cs-badge-cell">
              {img}
            </a>
          ) : (
            <span key={badge._id} className="cs-badge-cell">
              {img}
            </span>
          );
        })}
      </div>
    </section>
  );
}
