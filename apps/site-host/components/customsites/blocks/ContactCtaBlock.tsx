import type { CsContactCtaBlock } from '@/lib/customsites-sanity';
import { ContactForm } from '../ContactForm';

interface Props {
  block: CsContactCtaBlock;
  siteKey: string;
}

/** Two-column: copy left, inline lead form right (when showForm). */
export function ContactCtaBlock({ block, siteKey }: Props) {
  return (
    <section className="cs-section cs-section--muted" id="contact">
      <div className="cs-container">
        <div className="cs-contact-grid">
          <div>
            {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
            {block.heading ? <h2>{block.heading}</h2> : null}
            {block.body ? <p className="cs-lead">{block.body}</p> : null}
          </div>
          {block.showForm !== false ? <ContactForm siteKey={siteKey} /> : null}
        </div>
      </div>
    </section>
  );
}
