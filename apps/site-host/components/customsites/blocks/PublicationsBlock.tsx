import type { CsPublicationsBlock } from '@/lib/customsites-sanity';
import { fetchCustomSitePublicationsFull } from '@/lib/customsites-sanity';
import { ArticlesGrid } from '../ArticlesGrid';

interface Props {
  block: CsPublicationsBlock;
  siteKey: string;
}

const KIND_LABEL: Record<string, string> = {
  article: 'Article',
  publication: 'Publication',
  presentation: 'Presentation',
};

/** With a `limit`: a teaser list of the most recent N, any kind (home page).
 * Without one: the full article index in the shared card grid. */
export async function PublicationsBlock({ block, siteKey }: Props) {
  const all = await fetchCustomSitePublicationsFull(siteKey);

  if (!block.limit || block.limit <= 0) {
    // Always "Articles" here: this mode is the article index, regardless of
    // the heading the block carries from the WordPress import.
    return <ArticlesGrid articles={all.filter((p) => p.kind === 'article')} heading="Articles" />;
  }

  const publications = all.slice(0, block.limit);
  if (publications.length === 0) return null;

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        <div>
          {publications.map((pub) => (
            <article key={pub._id} className="cs-pub-card">
              <p className="cs-pub-meta">{KIND_LABEL[pub.kind] ?? 'Publication'}</p>
              <h3>{pub.title}</h3>
              {pub.excerpt ? <p className="cs-card-excerpt">{pub.excerpt}</p> : null}
              <a href={`/${pub.slug}`} className="cs-link">
                Read
                <span className="cs-link-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </article>
          ))}
        </div>
        {block.ctaLabel && block.ctaHref ? (
          <p style={{ marginTop: 24 }}>
            <a href={block.ctaHref} className="cs-btn cs-btn-secondary">
              {block.ctaLabel}
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
