import type { CustomSitePracticeAreaCard } from '@/lib/customsites-sanity';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';

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
export async function RelatedServices({ areas, currentSlug, heading, variant = 'section' }: Props) {
  if (variant === 'aside') {
    if (areas.length === 0) return null;

    // React.cache-deduped — the page this rail lives on has already resolved
    // the site once, so this is a free lookup, not a second Sanity round trip.
    const site = await resolveCurrentCustomSite();

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

        {/* Fills the dead space below a short service list on tall viewports
            with a second, lower-commitment CTA than the page's own contact
            form further down. Phone is read from the resolved site — never
            hardcoded. */}
        <div className="cs-services-rail-cta">
          <span className="cs-eyebrow cs-eyebrow--inverse">Free Case Review</span>
          <p>Have a construction dispute? Talk to our team before you decide your next step.</p>
          {site?.phone ? (
            <a href={`tel:${site.phone}`} className="cs-btn cs-btn-primary">
              Call {site.phone}
            </a>
          ) : null}
          <a href="/contact" className="cs-link">
            Request a Consultation
            <span className="cs-link-arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
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
