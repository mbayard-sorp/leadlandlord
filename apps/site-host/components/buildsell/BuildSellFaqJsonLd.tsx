import type { BuildSellSection } from '@/lib/sanity';

interface BuildSellFaqJsonLdProps {
  sections?: BuildSellSection[] | null;
}

/**
 * FAQPage JSON-LD emitted when a bsFaqSection with items exists.
 *
 * Renders nothing when no faq section or no items are present — safe to
 * include unconditionally on the page.
 */
export function BuildSellFaqJsonLd({ sections }: BuildSellFaqJsonLdProps) {
  const faqSection = sections?.find((s) => s._type === 'bsFaqSection');
  const items = faqSection?.items?.filter(
    (it) => it.question?.trim() && it.answer?.trim(),
  );

  if (!items || items.length === 0) return null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: it.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
