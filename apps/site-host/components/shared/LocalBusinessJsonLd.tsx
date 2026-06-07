import type { Bundle } from '../../lib/content';
import { buildLocalBusinessJsonLd } from './local-business-schema';

interface Props {
  bundle: Bundle;
  phone: string;
  url: string;
}

export function LocalBusinessJsonLd({ bundle, phone, url }: Props) {
  const json = buildLocalBusinessJsonLd(bundle, phone, url);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}

interface FaqProps {
  questions: Array<{ q: string; a: string }>;
}

/**
 * FAQPage JSON-LD. NOTE: since Google's April 2023 change, FAQ rich results are
 * shown only for well-known authoritative gov/health sites — these tenant sites
 * will NOT get FAQ rich snippets in the SERP. We keep this because it's still
 * valid, parsed by answer engines (AEO), and reinforces entity understanding —
 * but do not expect SERP real estate from it.
 */
export function FaqJsonLd({ questions }: FaqProps) {
  if (!questions.length) return null;
  const json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
