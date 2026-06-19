import type { BuildSellSection } from '@/lib/sanity';

interface ReviewsBlockProps {
  section: BuildSellSection;
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

export function ReviewsBlock({ section }: ReviewsBlockProps) {
  const reviews = section.reviews ?? [];

  return (
    <section className="bs-section" id="reviews">
      <div className="bs-container">
        <h2 className="bs-section-title">{section.heading ?? 'What Customers Say'}</h2>

        {section.showRating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
            <Stars rating={5} />
            <span className="bs-rating-label" style={{ color: 'var(--bs-muted)', fontSize: '0.9rem' }}>
              5.0 average
            </span>
          </div>
        )}

        <div className="bs-grid-3">
          {reviews.map((review, i) => (
            <div key={i} className="bs-review-card">
              <Stars rating={review.rating} />
              <p
                style={{
                  color: 'var(--bs-text)',
                  lineHeight: 1.65,
                  margin: '0.75rem 0 0',
                  fontSize: '0.95rem',
                }}
              >
                &ldquo;{review.text}&rdquo;
              </p>
              <p className="bs-review-author">{review.author}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
