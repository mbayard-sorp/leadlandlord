import type { BuildSellSection, BuildSellReview } from '@/lib/sanity';

interface ReviewsBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="bs-rating" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} aria-hidden="true" style={{ color: i < rating ? 'var(--bs-accent)' : 'var(--bs-muted)' }}>
          ★
        </span>
      ))}
    </span>
  );
}

function ReviewCard({ review, className }: { review: BuildSellReview; className?: string }) {
  return (
    <div className={`bs-review-card ${className ?? ''}`}>
      <Stars rating={review.rating} />
      <p className="bs-review-text">&ldquo;{review.text}&rdquo;</p>
      <div className="bs-review-footer">
        {/* Avatar: initials badge (image avatar is Phase 4 operator tooling) */}
        <div className="bs-review-avatar" aria-hidden="true">
          {review.initials ?? (review.author?.charAt(0) ?? '?')}
        </div>
        <div>
          <p className="bs-review-author">{review.author}</p>
          {review.location && (
            <p className="bs-review-location">{review.location}</p>
          )}
          {review.date && (
            <p className="bs-review-date">{review.date}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Reviews block layout per variant:
 * - split:  3-column grid (all reviews)
 * - bold:   featured review (large) + 2 supporting reviews side by side
 * - trust:  masonry-style staggered grid (CSS column-count)
 */
export function ReviewsBlock({ section, layoutVariant }: ReviewsBlockProps) {
  const reviews = section.reviews ?? [];
  const isBold = layoutVariant === 'bold';
  const isTrust = layoutVariant === 'trust';

  const featured = reviews.find((r) => r.featured) ?? reviews[0];
  const supporting = reviews.filter((r) => r !== featured).slice(0, 2);

  return (
    <section className="bs-section bs-reveal" id="reviews">
      <div className="bs-container">
        {section.heading && (
          <h2 className="bs-section-title">{section.heading}</h2>
        )}

        {section.showRating && (
          <div className="bs-reviews-aggregate">
            <Stars rating={5} />
            <span className="bs-rating-label">5.0 average</span>
          </div>
        )}

        {/* bold: featured + 2 */}
        {isBold && (
          <div className="bs-reviews-bold">
            {featured && (
              <ReviewCard review={featured} className="bs-review-card--featured" />
            )}
            {supporting.length > 0 && (
              <div className="bs-reviews-bold-supporting">
                {supporting.map((r, i) => (
                  <ReviewCard key={i} review={r} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* trust: masonry */}
        {isTrust && (
          <div className="bs-reviews-masonry">
            {reviews.map((r, i) => (
              <ReviewCard key={i} review={r} />
            ))}
          </div>
        )}

        {/* split (default): 3-col grid */}
        {!isBold && !isTrust && (
          <div className="bs-grid-3">
            {reviews.map((r, i) => (
              <ReviewCard key={i} review={r} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
