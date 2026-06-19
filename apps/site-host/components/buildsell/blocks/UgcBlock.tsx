import type { BuildSellSection } from '@/lib/sanity';
import { Icon } from '../Icon';

interface UgcBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/** Map a platform name to a lucide icon; fall back to a generic share icon. */
const PLATFORM_ICON_MAP: Record<string, string> = {
  facebook: 'facebook',
  instagram: 'instagram',
  twitter: 'twitter',
  x: 'twitter',
  linkedin: 'linkedin',
  youtube: 'youtube',
  tiktok: 'music-2',
  'music-2': 'music-2',
  pinterest: 'pinterest',
  nextdoor: 'map-pin',
  yelp: 'star',
};

function platformIcon(platform: string | null | undefined): string {
  if (!platform) return 'share-2';
  return PLATFORM_ICON_MAP[platform.toLowerCase()] ?? 'share-2';
}

/**
 * Curated social-proof / UGC gallery. Renders operator-approved post
 * thumbnails (captured during migration) with a platform badge, optional
 * caption, and an outbound link to the live post.
 *
 * Server-rendered (no third-party embed scripts) so it stays SSR-fast and
 * works on draft/noindex sites. Renders nothing when there are no items.
 */
export function UgcBlock({ section, layoutVariant: _layoutVariant }: UgcBlockProps) {
  const items = (section.items ?? [])
    .filter((it) => it.thumbnailUrl || it.postUrl)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (items.length === 0) return null;

  return (
    <section className="bs-section bs-reveal" id="social">
      <div className="bs-container">
        {section.heading && <h2 className="bs-section-title">{section.heading}</h2>}
        {section.subhead && <p className="bs-section-intro">{section.subhead}</p>}

        <div className="bs-ugc-grid">
          {items.map((it, i) => {
            const inner = (
              <>
                {it.thumbnailUrl ? (
                  <img
                    className="bs-ugc-thumb"
                    src={it.thumbnailUrl}
                    alt={it.caption ?? `${it.platform ?? 'Social'} post`}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="bs-ugc-thumb bs-ugc-thumb--placeholder" aria-hidden="true">
                    <Icon name={platformIcon(it.platform)} size={28} />
                  </div>
                )}
                <div className="bs-ugc-meta">
                  <span className="bs-ugc-platform" aria-hidden="true">
                    <Icon name={platformIcon(it.platform)} size={16} />
                  </span>
                  {it.caption && <p className="bs-ugc-caption">{it.caption}</p>}
                </div>
              </>
            );

            return it.postUrl ? (
              <a
                key={i}
                className="bs-ugc-card"
                href={it.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={it.caption ?? `View ${it.platform ?? 'social'} post`}
              >
                {inner}
              </a>
            ) : (
              <div key={i} className="bs-ugc-card">
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
