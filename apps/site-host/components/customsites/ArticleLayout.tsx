import type { CustomSitePublicationFull } from '@/lib/customsites-sanity';
import { PageHeader } from './PageHeader';
import { Prose } from './Prose';

interface Props {
  pub: CustomSitePublicationFull;
  related: CustomSitePublicationFull[];
  phone?: string | null;
  /** Publications/insights index path + label for the breadcrumb trail.
   * Defaults are site #1's; pass the site's own from the calling route. */
  indexPath?: string;
  indexLabel?: string;
}

const KIND_LABEL: Record<string, string> = {
  article: 'Article',
  publication: 'Publication',
  presentation: 'Presentation',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Publication detail-page renderer, used by app/cadr/[slug]/page.tsx when
 * the slug resolves to a csPublication. */
export function ArticleLayout({ pub, related, phone, indexPath = '/publications', indexLabel = 'Publications' }: Props) {
  return (
    <>
      <PageHeader
        eyebrow={KIND_LABEL[pub.kind] ?? 'Publication'}
        title={pub.title}
        breadcrumbs={[
          { name: 'Home', url: '/' },
          { name: indexLabel, url: indexPath },
          { name: pub.title, url: `${indexPath}/${pub.slug}` },
        ]}
      />

      <article className="cs-section">
        <div className="cs-container" style={{ maxWidth: 760 }}>
          <div className="cs-article-meta">
            <span>{formatDate(pub.publishedAt)}</span>
            {pub.externalEvent ? (
              <span>
                {pub.externalEvent}
                {pub.externalDate ? ` — ${pub.externalDate}` : ''}
              </span>
            ) : null}
            {pub.coAuthors ? <span>With {pub.coAuthors}</span> : null}
            {pub.authorName ? <span>By {pub.authorName}</span> : null}
          </div>

          {pub.excerpt ? <p className="cs-lead">{pub.excerpt}</p> : null}

          <Prose value={pub.body} />

          {pub.pdfUrl ? (
            <p style={{ marginTop: 32 }}>
              <a href={pub.pdfUrl} className="cs-btn cs-btn-secondary" target="_blank" rel="noopener noreferrer">
                Download PDF
              </a>
            </p>
          ) : null}
        </div>
      </article>

      {related.length > 0 ? (
        <div className="cs-section cs-section--muted">
          <div className="cs-container">
            <div className="cs-article-related">
              <h2>More Publications</h2>
              <ul className="cs-related-list" style={{ marginTop: 24 }}>
                {related.map((r) => (
                  <li key={r._id}>
                    <a href={`/${r.slug}`} className="cs-link">
                      {r.title}
                      <span className="cs-link-arrow" aria-hidden="true">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <section className="cs-section cs-cta-banner">
        <div className="cs-container">
          <h2>Have a construction dispute?</h2>
          <p style={{ marginTop: 24 }}>
            <a href={phone ? `tel:${phone}` : '/contact'} className="cs-btn cs-btn-primary">
              {phone ? `Call ${phone}` : 'Contact Us'}
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
