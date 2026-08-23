import type { CsLeadMagnetBlock } from '@/lib/customsites-sanity';
import { LeadMagnetCard } from './LeadMagnetCard';

interface Props {
  block: CsLeadMagnetBlock;
  siteKey: string;
}

/** Numbered benchmark-report download cards. Gated items collect name+email
 * through the magnet form (POST /api/cs-lead kind:"magnet" → firm gets the
 * lead, visitor gets the PDF link + immediate download). Ungated items link
 * straight to the PDF. Items without an uploaded PDF render nothing. */
export function LeadMagnetBlock({ block, siteKey }: Props) {
  const items = (block.items ?? []).filter((item) => Boolean(item.pdfUrl));
  if (items.length === 0) return null;

  return (
    <section className="cs-section cs-section--muted">
      <div className="cs-container">
        <div className="cs-magnet-header">
          {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
          {block.heading ? <h2>{block.heading}</h2> : null}
          {block.intro ? <p className="cs-lead cs-magnet-intro">{block.intro}</p> : null}
        </div>
        <div className="cs-magnet-grid">
          {items.map((item, i) => (
            <LeadMagnetCard key={item._key} item={item} index={i + 1} siteKey={siteKey} />
          ))}
        </div>
      </div>
    </section>
  );
}
