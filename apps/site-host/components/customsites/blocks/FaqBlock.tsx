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
 */
export function FaqBlock({ block, phone }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="cs-section">
      <div className="cs-container">
        <PageFaq
          faqs={items.map((f) => ({ q: f.question, a: f.answer }))}
          heading={block.heading ?? 'Frequently Asked Questions'}
          phone={phone ?? ''}
        />
      </div>
    </section>
  );
}
