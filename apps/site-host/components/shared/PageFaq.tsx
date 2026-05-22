import { FaqJsonLd } from './LocalBusinessJsonLd';
import { substitutePhone } from '../../lib/phone';

interface PageFaqProps {
  faqs: Array<{ q: string; a: string }>;
  /** Section heading, e.g. "Frequently asked questions about Tree Removal". */
  heading: string;
  /** Tenant tracking number — replaces `{{phone}}` tokens in Q&A text. */
  phone: string;
}

/**
 * Visible FAQ section + matching FAQPage JSON-LD for service / service-area
 * pages. Renders both from the same data so the structured data always mirrors
 * what's on the page — Google requires FAQPage markup to reflect visible
 * content, and divergence risks a manual action. Returns null when there are
 * no FAQs, so callers can pass through `page.faqs ?? []` unconditionally.
 *
 * Theme-agnostic: styled with the info-page CSS variables, no per-variant code.
 */
export function PageFaq({ faqs, heading, phone }: PageFaqProps) {
  if (faqs.length === 0) return null;
  const resolved = faqs.map((f) => ({
    q: substitutePhone(f.q, phone),
    a: substitutePhone(f.a, phone),
  }));
  return (
    <section className="info-page-faq" aria-labelledby="faq-heading">
      <FaqJsonLd questions={resolved} />
      <h2 id="faq-heading" className="info-page-faq-heading">
        {heading}
      </h2>
      {resolved.map((f, i) => (
        <details key={i} className="info-page-faq-item" open={i === 0}>
          <summary className="info-page-faq-q">{f.q}</summary>
          <p className="info-page-faq-a">{f.a}</p>
        </details>
      ))}
    </section>
  );
}
