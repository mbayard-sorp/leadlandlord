import type { CustomSitePublicationFull } from '@/lib/customsites-sanity';

interface Props {
  articles: CustomSitePublicationFull[];
  heading?: string;
}

/** Truncates a teaser to a card-friendly length without cutting mid-word or
 * mid-clause (the source excerpt can run long, and a naive character-count
 * slice produces artifacts like "...or an…"). Prefers breaking at the end of
 * a sentence within the budget; falls back to the last whole word, stripping
 * any dangling punctuation before the ellipsis. */
function truncateExcerpt(text: string, max = 220): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;

  const slice = trimmed.slice(0, max);
  const lastSentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
  if (lastSentenceEnd > max * 0.5) {
    return slice.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = slice.lastIndexOf(' ');
  const wholeWords = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${wholeWords.trim().replace(/[,;:—-]+$/, '')}…`;
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
              {pub.excerpt ? <p className="cs-card-excerpt">{truncateExcerpt(pub.excerpt)}</p> : null}
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
