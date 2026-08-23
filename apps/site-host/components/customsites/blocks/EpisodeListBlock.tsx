import type { CsEpisodeListBlock, CustomSitePublicationFull } from '@/lib/customsites-sanity';
import { fetchCustomSitePublicationsFull } from '@/lib/customsites-sanity';
import { PlatformGlyph, PlayIcon, PLATFORM_LABELS } from '../icons';

interface Props {
  block: CsEpisodeListBlock;
  siteKey: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Podcast episode / talk list over csPublication docs, filtered by kind.
 * Episode number, duration, and listen links each degrade independently
 * when absent — no "Ep. ?" placeholders. Each row links to the episode's own
 * page at /<slug>, the same destination PublicationsBlock uses. */
export async function EpisodeListBlock({ block, siteKey }: Props) {
  const all = await fetchCustomSitePublicationsFull(siteKey);
  const filtered: CustomSitePublicationFull[] = block.kind ? all.filter((p) => p.kind === block.kind) : all;
  const limit = block.limit && block.limit > 0 ? block.limit : 12;
  const episodes = filtered.slice(0, limit);
  if (episodes.length === 0) return null;

  const showListen = block.showListenLinks !== false;

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        <div style={{ marginTop: 'var(--cs-space-4)' }}>
          {episodes.map((ep) => (
            <article key={ep._id} className="cs-episode">
              <span className="cs-episode-play" aria-hidden="true">
                <PlayIcon />
              </span>
              <div>
                {ep.episodeNumber != null ? <span className="cs-episode-num">Ep. {ep.episodeNumber}</span> : null}
                {/* The title link stretches over the whole row (see
                 * .cs-episode-link::after) so the row is clickable, while the
                 * listen links stay above it and keep their own targets. */}
                <h3>
                  <a href={`/${ep.slug}`} className="cs-episode-link">
                    {ep.title}
                  </a>
                </h3>
                {ep.excerpt ? <p className="cs-card-excerpt">{ep.excerpt}</p> : null}
                <p className="cs-episode-duration">
                  {formatDate(ep.publishedAt)}
                  {ep.durationMinutes != null ? ` · ${ep.durationMinutes} min` : ''}
                </p>
                {showListen && ep.listenLinks && ep.listenLinks.length > 0 ? (
                  <div className="cs-listen-links" style={{ marginTop: 'var(--cs-space-2)' }}>
                    {ep.listenLinks.map((link) => (
                      <a
                        key={link.url}
                        href={link.url}
                        className="cs-listen-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <PlatformGlyph platform={link.platform} />
                        {link.label ?? PLATFORM_LABELS[link.platform] ?? 'Listen'}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        {block.ctaLabel && block.ctaHref ? (
          <p style={{ marginTop: 'var(--cs-space-4)' }}>
            <a href={block.ctaHref} className="cs-btn cs-btn-secondary">
              {block.ctaLabel}
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
