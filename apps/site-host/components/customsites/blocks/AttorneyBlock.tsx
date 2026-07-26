import Image from 'next/image';
import { csImageUrl, type CsAttorneyBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';

interface Props {
  block: CsAttorneyBlock;
}

/**
 * Portrait + bio summary + credentials. On a home page (showFullProfile off)
 * it links to the full profile page; on the profile page itself
 * (showFullProfile on) it renders the attorney's bio sections in full.
 */
export function AttorneyBlock({ block }: Props) {
  const attorney = block.attorney;
  if (!attorney) return null;

  const fullProfile = block.showFullProfile === true;
  const sections = attorney.bioSections ?? [];

  return (
    <section className="cs-section">
      <div className="cs-container">
        <div className="cs-attorney">
          <div className="cs-attorney-photo">
            {attorney.photoUrl ? (
              <Image
                src={csImageUrl(attorney.photoUrl, { w: 900 })}
                alt={`Portrait of ${attorney.name}`}
                fill
                sizes="(max-width: 899px) 100vw, 260px"
                style={{ objectFit: 'cover' }}
              />
            ) : null}
          </div>
          <div>
            <h2>{attorney.name}</h2>
            {attorney.jobTitle ? <p className="cs-lead">{attorney.jobTitle}</p> : null}
            {fullProfile && (attorney.phone || attorney.email || attorney.vCardUrl) ? (
              <div className="cs-reach-us">
                <span className="cs-eyebrow">Reach Us</span>
                <dl>
                  {attorney.phone ? (
                    <div>
                      <dt>Phone:</dt>
                      <dd>
                        <a href={`tel:${attorney.phone}`}>{attorney.phone}</a>
                      </dd>
                    </div>
                  ) : null}
                  {attorney.email ? (
                    <div>
                      <dt>Email:</dt>
                      <dd>
                        <a href={`mailto:${attorney.email}`}>{attorney.email}</a>
                      </dd>
                    </div>
                  ) : null}
                  {attorney.vCardUrl ? (
                    <div>
                      <dt>vCard:</dt>
                      <dd>
                        <a href={attorney.vCardUrl} download>
                          Download vCard
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
            <Prose value={attorney.bio} />
            {attorney.credentials && attorney.credentials.length > 0 ? (
              <ul className="cs-attorney-credentials">
                {attorney.credentials.map((c) => (
                  <li key={c.name}>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer">
                        {c.name}
                      </a>
                    ) : (
                      c.name
                    )}
                    {c.issuer ? ` — ${c.issuer}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            {/* Summary mode (home): link out to the profile page. The schema is
                generic (no per-site "profile page" ref), so this falls back to
                the known route rather than guessing from attorney.slug. */}
            {!fullProfile ? (
              <p style={{ marginTop: 24 }}>
                <a href="/mikes-story" className="cs-link">
                  Attorney Profile
                  <span className="cs-link-arrow" aria-hidden="true">
                    →
                  </span>
                </a>
              </p>
            ) : null}
          </div>
        </div>

        {fullProfile && sections.length > 0 ? (
          <div className="cs-attorney-sections">
            {sections.map((section, i) => (
              <div key={section.heading ?? i} className="cs-attorney-section">
                {section.heading ? <h3>{section.heading}</h3> : null}
                <Prose value={section.content} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
