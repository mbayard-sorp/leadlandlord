import type { CSSProperties } from 'react';
import Image from 'next/image';
import { csImageUrl, type CsBadgeItem, type CsBadgeRowBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsBadgeRowBlock;
}

/** Seconds each logo takes to travel the strip. Duration scales with the number
 *  of logos so the belt moves at one speed no matter how many are on it. */
const SECONDS_PER_LOGO = 4;

function BadgeCell({ badge, clone }: { badge: CsBadgeItem; clone?: boolean }) {
  const img = badge.imageUrl ? (
    <span className="cs-badge-img">
      <Image
        src={csImageUrl(badge.imageUrl, { w: 440 })}
        alt={clone ? '' : (badge.imageAlt ?? badge.name)}
        fill
        sizes="220px"
        style={{ objectFit: 'contain' }}
      />
    </span>
  ) : null;

  // The duplicated half of a marquee is decorative: it must not be reachable by
  // keyboard or announced, or every logo lands in the tab order twice.
  if (badge.url && !clone) {
    return (
      <a href={badge.url} target="_blank" rel="noopener noreferrer" className="cs-badge-cell">
        {img}
      </a>
    );
  }
  return <span className="cs-badge-cell">{img}</span>;
}

/**
 * Grayscale affiliation/award logos, color on hover.
 *
 * With `scroll` the strip becomes a marquee: the track holds two identical
 * copies of the list and slides exactly one copy-width, so the seam never shows
 * and the loop is continuous. Everything past the first copy is aria-hidden.
 */
export function BadgeRowBlock({ block }: Props) {
  const badges = block.badges ?? [];
  if (badges.length === 0) return null;

  const header =
    block.eyebrow || block.heading ? (
      <div className="cs-container cs-badge-header">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
      </div>
    ) : null;

  if (!block.scroll) {
    return (
      <section className="cs-section cs-badge-section">
        {header}
        <div className="cs-container cs-badge-row">
          {badges.map((badge) => (
            <BadgeCell key={badge._id} badge={badge} />
          ))}
        </div>
      </section>
    );
  }

  const duration = `${badges.length * SECONDS_PER_LOGO}s`;

  return (
    <section className="cs-section cs-badge-section">
      {header}
      <div className="cs-badge-marquee">
        <div
          className="cs-badge-track"
          style={{ '--cs-badge-marquee-duration': duration } as CSSProperties}
        >
          {/* Both halves must be identical boxes for the -50% slide to land back
              on the seam. The gap after the last logo of a group is the group's
              own trailing padding, not a track gap, so the two are exact. */}
          <div className="cs-badge-group">
            {badges.map((badge) => (
              <BadgeCell key={badge._id} badge={badge} />
            ))}
          </div>
          <div className="cs-badge-group" aria-hidden="true">
            {badges.map((badge) => (
              <BadgeCell key={`clone-${badge._id}`} badge={badge} clone />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
