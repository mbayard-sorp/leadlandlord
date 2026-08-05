import type { CsDisclosureBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';

interface Props {
  block: CsDisclosureBlock;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Legal / disclosures page slab: heading, "Last updated" line (compliance
 * reviewers look for it), Portable Text body, boxed footnote. */
export function DisclosureBlock({ block }: Props) {
  return (
    <section className="cs-section">
      <div className="cs-container cs-disclosure">
        {block.heading ? <h2>{block.heading}</h2> : null}
        {block.lastUpdated ? <p className="cs-disclosure-updated">Last updated {formatDate(block.lastUpdated)}</p> : null}
        <Prose value={block.content} />
        {block.note ? <p className="cs-disclosure-note">{block.note}</p> : null}
      </div>
    </section>
  );
}
