import type { Bundle, Variant } from '../../lib/content';

interface Props {
  bundle: Bundle;
  variant: Variant;
  title?: string;
}

/** Source label map for human-readable attribution. */
const SOURCE_LABEL: Record<string, string> = {
  google: 'via Google',
  yelp: 'via Yelp',
  bbb: 'via BBB',
  facebook: 'via Facebook',
  direct: 'direct',
};

/** Render filled/empty star row. */
function StarRow({ rating }: { rating: number }) {
  return (
    <span className="review-stars" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={i < rating ? 'review-star review-star-filled' : 'review-star review-star-empty'}
          aria-hidden
        >
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * Displays up to 6 customer reviews with star ratings, quote text, author,
 * source label, and date.
 *
 * Premium variant: CSS scroll-snap horizontal carousel (no JS).
 * All other variants: responsive grid.
 *
 * Renders nothing when `bundle.reviews` is empty — ADR 0003.
 */
export function ReviewsSection({ bundle, variant, title }: Props) {
  if (bundle.reviews.length === 0) return null;

  const reviews = bundle.reviews.slice(0, 6);
  const heading = title ?? 'What our customers say';
  const isPremium = variant === 'premium';

  return (
    <section
      className={`reviews-section reviews-section-${variant}`}
      aria-labelledby="reviews-heading"
    >
      <h2 id="reviews-heading" className="reviews-heading">{heading}</h2>
      <div
        className={isPremium ? 'reviews-carousel' : 'reviews-grid'}
        role="list"
        aria-label="Customer reviews"
      >
        {reviews.map((review, i) => (
          <article
            key={`${review.author}-${i}`}
            className={`review-card review-card-${variant}`}
            role="listitem"
          >
            <StarRow rating={review.rating} />
            <blockquote className="review-text">
              <p>
                {review.text.length > 200
                  ? `${review.text.slice(0, 197)}…`
                  : review.text}
              </p>
            </blockquote>
            <footer className="review-meta">
              <span className="review-author">{review.author}</span>
              <span className="review-source">{SOURCE_LABEL[review.source] ?? review.source}</span>
              <time className="review-date" dateTime={review.date}>
                {review.date}
              </time>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
