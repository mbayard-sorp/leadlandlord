import type { CsFocusAreaListBlock, CustomSitePracticeAreaCard } from '@/lib/customsites-sanity';
import { fetchCustomSitePracticeAreaCards } from '@/lib/customsites-sanity';
import { csSitePaths } from '@/lib/customsites-registry';

interface Props {
  block: CsFocusAreaListBlock;
  siteKey: string;
  /** Index of this block in the page, used to open the first item only once per page. */
  defaultOpenFirst?: boolean;
}

/** Numbered focus-area accordion over csPracticeArea docs — `<details>`
 * items, zero JS, first item open. Deliverable counts are the length of each
 * area's deliverables list, never a typed number. */
export async function FocusAreaListBlock({ block, siteKey, defaultOpenFirst = true }: Props) {
  const areas: CustomSitePracticeAreaCard[] = block.areas?.length
    ? block.areas
    : await fetchCustomSitePracticeAreaCards(siteKey);
  if (areas.length === 0) return null;

  const { servicesPath } = csSitePaths(siteKey);
  const showCounts = block.showDeliverableCounts !== false;

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        {block.summaryLine ? <p className="cs-lead">{block.summaryLine}</p> : null}
        <div className="cs-focus-list" style={{ marginTop: 'var(--cs-space-5)' }}>
          {areas.map((area, i) => {
            const count = area.deliverables?.length ?? 0;
            return (
              <details key={area._id} className="cs-focus-item" open={defaultOpenFirst && i === 0}>
                <summary className="cs-focus-summary">
                  <span className="cs-focus-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="cs-focus-title">{area.title}</span>
                  {showCounts && count > 0 ? <span className="cs-focus-count">{count}</span> : null}
                </summary>
                <div className="cs-focus-body">
                  {area.excerpt ? <p>{area.excerpt}</p> : null}
                  {area.deliverables && area.deliverables.length > 0 ? (
                    <ul className="cs-focus-deliverables">
                      {area.deliverables.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p style={{ marginTop: 'var(--cs-space-4)' }}>
                    <a href={`/${servicesPath}/${area.slug}`} className="cs-link">
                      Learn more
                      <span className="cs-link-arrow" aria-hidden="true">
                        →
                      </span>
                    </a>
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </section>
  );
}
