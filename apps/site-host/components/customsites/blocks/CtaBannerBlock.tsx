import type { CsCtaBannerBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsCtaBannerBlock;
  phone?: string | null;
}

/** Brass band: heading + button. */
export function CtaBannerBlock({ block, phone }: Props) {
  const href = block.ctaHref?.trim() || (phone ? `tel:${phone}` : '/contact');
  const label = block.ctaLabel?.trim() || (phone ? `Call ${phone}` : 'Contact Us');

  return (
    <section className="cs-section cs-cta-banner">
      <div className="cs-container">
        {block.heading ? <h2>{block.heading}</h2> : null}
        <p style={{ marginTop: 24 }}>
          <a href={href} className="cs-btn cs-btn-primary">
            {label}
          </a>
        </p>
      </div>
    </section>
  );
}
