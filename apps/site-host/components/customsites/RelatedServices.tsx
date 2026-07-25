import type { CustomSitePracticeAreaCard } from '@/lib/customsites-sanity';

interface Props {
  areas: CustomSitePracticeAreaCard[];
  currentSlug: string;
  heading?: string;
  /**
   * "aside" renders the navy rail used alongside practice-area copy and keeps
   * the current page in the list (marked current). "section" is the standalone
   * full-width list used elsewhere.
   */
  variant?: 'section' | 'aside';
}

/** Sibling practice-area links. Aside variant is the navy "Other ADR Services" rail. */
export function RelatedServices({ areas, currentSlug, heading, variant = 'section' }: Props) {
  if (variant === 'aside') {
    if (areas.length === 0) return null;
    return (
      <aside className="cs-services-rail" aria-labelledby="other-services-heading">
        <h2 id="other-services-heading">{heading ?? 'Other ADR Services'}</h2>
        <ul>
          {areas.map((area) => {
            const isCurrent = area.slug === currentSlug;
            return (
              <li key={area._id}>
                <a
                  href={`/practice-areas/${area.slug}`}
                  className={isCurrent ? 'is-current' : undefined}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {area.title}
                </a>
              </li>
            );
          })}
        </ul>
      </aside>
    );
  }

  const siblings = areas.filter((a) => a.slug !== currentSlug);
  if (siblings.length === 0) return null;

  return (
    <section className="cs-section" aria-labelledby="related-services-heading">
      <div className="cs-container">
        <h2 id="related-services-heading">{heading ?? 'Related Practice Areas'}</h2>
        <ul className="cs-related-list">
          {siblings.map((area) => (
            <li key={area._id}>
              <a href={`/practice-areas/${area.slug}`} className="cs-link">
                {area.title}
                <span className="cs-link-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
