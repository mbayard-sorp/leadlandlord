import Image from 'next/image';
import type { CsTeamGridBlock, CsTeamMemberCard } from '@/lib/customsites-sanity';
import { csImageUrl, fetchCustomSiteTeamCards } from '@/lib/customsites-sanity';

interface Props {
  block: CsTeamGridBlock;
  siteKey: string;
}

/** Team roster grid over csAttorney docs. Missing photo → the brass-keyline
 * monogram plate, never a stock face. linkToProfiles off renders a
 * non-clickable roster (for when bios aren't written yet). */
export async function TeamGridBlock({ block, siteKey }: Props) {
  const members: CsTeamMemberCard[] =
    block.mode === 'selected' ? (block.members ?? []) : await fetchCustomSiteTeamCards(siteKey);

  if (members.length === 0) return null;

  const linked = block.linkToProfiles !== false;

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        {block.intro ? <p className="cs-lead">{block.intro}</p> : null}
        <div className="cs-team-grid" style={{ marginTop: 'var(--cs-space-5)' }}>
          {members.map((member) => {
            const inner = (
              <>
                <div className="cs-team-photo">
                  {member.photoUrl ? (
                    <Image
                      src={csImageUrl(member.photoUrl, { w: 640 })}
                      alt={member.photoAlt ?? member.name}
                      width={640}
                      height={800}
                    />
                  ) : (
                    <div className="cs-team-monogram" aria-hidden="true">
                      {member.name.charAt(0)}
                    </div>
                  )}
                </div>
                <div className="cs-team-name">{member.name}</div>
                {member.jobTitle ? <div className="cs-team-role">{member.jobTitle}</div> : null}
              </>
            );
            return linked ? (
              <a key={member._id} href={`/team/${member.slug}`} className="cs-team-card">
                {inner}
              </a>
            ) : (
              <div key={member._id} className="cs-team-card">
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
