import type { BuildSellSection } from '@/lib/sanity';
import { isFaqItemOpen, resolveFaqDefaultOpen } from '../buildsell-faq';

interface FaqBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/**
 * FAQ accordion — the visible counterpart to BuildSellFaqJsonLd, which emits
 * FAQPage structured data off the same `items` array.
 *
 * Built on native <details>/<summary> so the whole thing is server-rendered:
 * no client JS, keyboard + screen-reader behaviour for free, and every answer
 * is in the DOM for crawlers even while collapsed.
 *
 * `defaultOpen` picks the resting state, and only the resting state — the
 * markup is identical either way, so collapsing never costs indexable text:
 *  - 'first' (default): opening item, so the section reads as content rather
 *    than a stack of bare labels
 *  - 'all':   every answer showing — right when the items are short benefit
 *             blurbs rather than genuine questions
 *  - 'none':  everything collapsed — right for a long scannable Q&A list
 *
 * Per-variant layout (all three templates render it — only the framing moves):
 *  - split: heading rail on the left, accordion on the right
 *  - bold:  full-bleed rows separated by rules, oversized questions
 *  - trust: centered column of cards
 */
export function FaqBlock({ section, layoutVariant }: FaqBlockProps) {
  const items = (section.items ?? []).filter(
    (it) => it.question?.trim() && it.answer?.trim(),
  );
  if (items.length === 0) return null;

  const isSplit = layoutVariant === 'split';
  const defaultOpen = resolveFaqDefaultOpen(section.defaultOpen);

  const head = (
    <div className="bs-section-head bs-faq-head">
      {section.eyebrow && <p className="bs-section-eyebrow">{section.eyebrow}</p>}
      {section.heading && <h2 className="bs-section-title">{section.heading}</h2>}
    </div>
  );

  const list = (
    <div className="bs-faq-list">
      {items.map((item, i) => (
        <details
          key={i}
          className="bs-faq-item"
          open={isFaqItemOpen(i, defaultOpen)}
        >
          <summary className="bs-faq-q">
            <span className="bs-faq-q-text">{item.question}</span>
            <span className="bs-faq-marker" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
          </summary>
          <div className="bs-faq-a">
            <p>{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  );

  return (
    <section className="bs-section bs-reveal" id="faq">
      <div className="bs-container">
        {isSplit ? (
          <div className="bs-faq-split">
            {head}
            {list}
          </div>
        ) : (
          <>
            {head}
            {list}
          </>
        )}
      </div>
    </section>
  );
}
