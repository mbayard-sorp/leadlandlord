import type { CsCaseStudyGridBlock, CustomSiteCaseStudy } from '@/lib/customsites-sanity';
import { fetchCustomSiteCaseStudies } from '@/lib/customsites-sanity';

interface Props {
  block: CsCaseStudyGridBlock;
  siteKey: string;
}

/** Before→after client-outcome cards. The approvedForUse compliance gate is
 * enforced in the fetch query; "selected" mode references can only surface
 * docs the fetch already approved, so the block re-filters against them. */
export async function CaseStudyGridBlock({ block, siteKey }: Props) {
  const approved = await fetchCustomSiteCaseStudies(siteKey);
  const approvedIds = new Set(approved.map((c) => c._id));

  let items: CustomSiteCaseStudy[] =
    block.mode === 'selected' ? (block.items ?? []).filter((c) => approvedIds.has(c._id)) : approved;
  items = items.slice(0, block.limit && block.limit > 0 ? block.limit : 3);
  if (items.length === 0) return null;

  return (
    <section className="cs-section cs-section--muted">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        <div className="cs-grid-3" style={{ marginTop: 'var(--cs-space-5)' }}>
          {items.map((cs) => (
            <article key={cs._id} className="cs-case-card">
              <div className="cs-case-figures">
                {cs.afterValue ? (
                  <>
                    <span className="cs-case-before">{cs.beforeValue}</span>
                    <span className="cs-case-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="cs-case-after">{cs.afterValue}</span>
                  </>
                ) : (
                  <span className="cs-case-after">{cs.beforeValue}</span>
                )}
              </div>
              <p className="cs-case-metric">{cs.metricLabel}</p>
              <h3>{cs.headline}</h3>
              {cs.clientDescriptor ? <p className="cs-card-excerpt">{cs.clientDescriptor}</p> : null}
              {cs.timeframe ? <p className="cs-case-metric">{cs.timeframe}</p> : null}
            </article>
          ))}
        </div>
        {block.disclaimer ? <p className="cs-case-disclaimer" style={{ marginTop: 'var(--cs-space-4)' }}>{block.disclaimer}</p> : null}
      </div>
    </section>
  );
}
