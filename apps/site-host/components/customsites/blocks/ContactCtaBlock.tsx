import type { CsContactCtaBlock } from '@/lib/customsites-sanity';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { ContactForm } from '../ContactForm';

interface Props {
  block: CsContactCtaBlock;
  siteKey: string;
}

/** Two-column: copy + firm NAP left, inline lead form right (when showForm). */
export async function ContactCtaBlock({ block, siteKey }: Props) {
  // React.cache-deduped — the page has already resolved the site once, so
  // this doesn't cost a second Sanity round trip.
  const site = await resolveCurrentCustomSite();
  const addr = site?.address;
  const hasAddress = Boolean(addr?.street || addr?.city);
  const hasReachUs = Boolean(hasAddress || site?.phone || site?.email);

  return (
    <section className="cs-section cs-section--muted" id="contact">
      <div className="cs-container">
        <div className="cs-contact-grid">
          <div className={block.formVariant === 'consultation' ? 'cs-contact-aside' : undefined}>
            {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
            {block.heading ? <h2>{block.heading}</h2> : null}
            {block.body ? <p className="cs-lead">{block.body}</p> : null}

            {/* Consultation "Here's what we'll cover" checklist beside the
                form (csContactCtaBlock.checklist). */}
            {block.checklist && block.checklist.length > 0 ? (
              <ul className="cs-contact-checklist">
                {block.checklist.map((item) => (
                  <li key={item._key}>
                    <strong>{item.heading}</strong>
                    {item.body ? <p>{item.body}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* The left column was empty dead space while the form carried the
                whole section on its own — fill it with the firm's actual NAP,
                read from the resolved site (never hardcoded). */}
            {hasReachUs ? (
              <div className="cs-reach-us">
                <span className="cs-eyebrow">Reach Us</span>
                <dl>
                  {hasAddress ? (
                    <div>
                      <dt>Address:</dt>
                      <dd>
                        {addr?.street ? (
                          <>
                            {addr.street}
                            <br />
                          </>
                        ) : null}
                        {addr?.unit ? (
                          <>
                            {addr.unit}
                            <br />
                          </>
                        ) : null}
                        {[addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ')}
                      </dd>
                    </div>
                  ) : null}
                  {site?.phone ? (
                    <div>
                      <dt>Phone:</dt>
                      <dd>
                        <a href={`tel:${site.phone}`}>{site.phone}</a>
                      </dd>
                    </div>
                  ) : null}
                  {site?.email ? (
                    <div>
                      <dt>Email:</dt>
                      <dd>
                        <a href={`mailto:${site.email}`}>{site.email}</a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="cs-reach-us-note">We respond to every inquiry personally.</p>
              </div>
            ) : null}
          </div>
          {block.showForm !== false ? (
            <div className="cs-contact-form-panel">
              <ContactForm
                siteKey={siteKey}
                variant={block.formVariant === 'consultation' ? 'consultation' : 'standard'}
                footnote={block.formFootnote}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
