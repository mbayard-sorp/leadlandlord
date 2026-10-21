import type { CsFaqBlock } from '@/lib/customsites-sanity';
import { PageFaq } from '@/components/shared/PageFaq';

interface Props {
  block: CsFaqBlock;
  phone?: string | null;
}

/**
 * Standalone FAQ surface for any csPage (ADR 0033 Amendment 1 D10), reusing
 * the shared PageFaq/FaqJsonLd pair so the visible FAQ list and its FAQPage
 * JSON-LD always agree (same reasoning as csPracticeArea.faqs — see PageFaq's
 * docblock). csPracticeArea's own `faqs` array is unrelated and unaffected.
 *
 * `layout: 'split'` (heading left, questions right) and the optional outro
 * line ("Still stuck? Write to us and a person answers.") are opt-in; a block
 * with neither renders exactly as before. The split section also claims the
 * #support anchor the CueDuo nav points at.
 */
export function FaqBlock({ block, phone }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  const split = block.layout === 'split';
  const stacked = block.layout === 'stacked';
  const hasOutro = Boolean(block.outroLead || (block.outroLinkLabel && block.outroLinkHref) || block.outroTail);
  const outro = hasOutro ? (
    <p className="cs-faq-outro">
      {block.outroLead ? `${block.outroLead} ` : null}
      {block.outroLinkLabel && block.outroLinkHref ? <a href={block.outroLinkHref}>{block.outroLinkLabel}</a> : null}
      {block.outroTail ? ` ${block.outroTail}` : null}
    </p>
  ) : null;

  const sectionClass = `cs-section${split ? ' cs-faq cs-faq--split' : ''}${stacked ? ' cs-faq--stacked' : ''}`;

  return (
    <section className={sectionClass} id={split ? 'support' : undefined}>
      <div className="cs-container">
        <PageFaq
          faqs={items.map((f) => ({ q: f.question, a: f.answer }))}
          heading={block.heading ?? 'Frequently Asked Questions'}
          phone={phone ?? ''}
          outro={outro}
        />
      </div>
    </section>
  );
}
