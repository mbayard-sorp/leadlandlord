import Image from 'next/image';
import type { CsPracticeGridBlock, CustomSitePracticeAreaCard } from '@/lib/customsites-sanity';
import { csImageUrl, fetchCustomSitePracticeAreaCards } from '@/lib/customsites-sanity';
import { csSitePaths } from '@/lib/customsites-registry';

interface Props {
  block: CsPracticeGridBlock;
  siteKey: string;
}

/** 3-column practice-area card grid (1-col on mobile). "All" mode fetches
 * every csPracticeArea for the site; "selected" mode uses the block's own
 * ordered reference list, already resolved by the pageBuilder projection. */
export async function PracticeGridBlock({ block, siteKey }: Props) {
  const areas: CustomSitePracticeAreaCard[] =
    block.mode === 'selected' ? (block.areas ?? []) : await fetchCustomSitePracticeAreaCards(siteKey);

  if (areas.length === 0) return null;

  const { servicesPath } = csSitePaths(siteKey);

  // With no eyebrow or heading the section's top padding just doubles up with
  // the preceding section's bottom padding, so drop it in that case.
  const hasHead = Boolean(block.eyebrow || block.heading);

  return (
    <section className={hasHead ? 'cs-section' : 'cs-section cs-section--flush-top'} id="practice-areas">
      <div className="cs-container">
        {hasHead ? (
          <div className="cs-section-head" data-cs-reveal>
            {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
            {block.heading ? <h2>{block.heading}</h2> : null}
          </div>
        ) : null}
        <div className="cs-grid-3">
          {areas.map((area) => (
            <div key={area._id} className="cs-card" data-cs-reveal>
              {area.cardImageUrl ? (
                <div className="cs-card-media">
                  <Image
                    src={csImageUrl(area.cardImageUrl, { w: 720 })}
                    alt={area.cardImageAlt ?? ''}
                    fill
                    sizes="(max-width: 899px) 100vw, 360px"
                    style={{ objectFit: 'cover' }}
                  />
                </div>
              ) : null}
              <h3>{area.title}</h3>
              {area.excerpt ? <p className="cs-card-excerpt">{area.excerpt}</p> : null}
              <a href={`/${servicesPath}/${area.slug}`} className="cs-link">
                Learn more
                <span className="cs-link-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
