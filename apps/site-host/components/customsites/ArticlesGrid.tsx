import type { CustomSitePublicationFull } from '@/lib/customsites-sanity';

interface Props {
  articles: CustomSitePublicationFull[];
  heading?: string;
}

/** Article card grid. Shared so the Construction Industry page and any other
 * surface render the article list identically. */
export function ArticlesGrid({ articles, heading = 'Articles' }: Props) {
  if (articles.length === 0) return null;

  return (
    <section className="cs-section">
      <div className="cs-container">
        <h2>{heading}</h2>
        <div className="cs-grid-3">
          {articles.map((pub) => (
            <article key={pub._id} className="cs-card">
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
      </div>
    </section>
  );
}
