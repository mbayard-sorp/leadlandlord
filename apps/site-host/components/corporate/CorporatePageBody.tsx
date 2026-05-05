import type { CorporatePage, CorporateSite } from '../../lib/sanity';
import { Markdown } from '../shared/Markdown';

interface Props {
  page: CorporatePage;
  site: CorporateSite;
  /** When true, render the optional hero block above the body. Defaults to true. */
  hero?: boolean;
}

/**
 * Generic renderer for a corporatePage doc. Used by every leaf route under
 * /leadslandlord/* — each route just fetches its kind and hands the page +
 * site to this component.
 */
export function CorporatePageBody({ page, site, hero = true }: Props) {
  const cta = site.primaryCta;
  return (
    <article className="corp-article">
      {hero && (page.heroEyebrow || page.heroHeadline || page.heroSubhead) ? (
        <header className="corp-hero">
          {page.heroEyebrow ? <p className="corp-hero-eyebrow">{page.heroEyebrow}</p> : null}
          {page.heroHeadline ? <h1 className="corp-hero-h1">{page.heroHeadline}</h1> : null}
          {page.heroSubhead ? <p className="corp-hero-subhead">{page.heroSubhead}</p> : null}
          {cta?.label && cta.href ? (
            <a href={cta.href} className="corp-cta-button corp-hero-cta">
              {cta.label}
            </a>
          ) : null}
        </header>
      ) : null}
      {page.mdx ? <Markdown source={page.mdx} className="corp-prose" /> : null}
      {page.jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: page.jsonLd }} />
      ) : null}
    </article>
  );
}
