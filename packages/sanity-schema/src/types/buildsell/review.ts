import { defineType, defineField } from 'sanity';

/**
 * Build & Sell review document. Referenceable, featurable, sortable.
 *
 * ToS GUARD: this holds Claude-written REPRESENTATIVE testimonial copy
 * derived from business name + category + city only. It must NEVER contain
 * verbatim Google review text. The aggregate star rating is shown via
 * `bsReviewsSection.showRating`; individual review text here is original copy.
 *
 * Deterministic id `bs-review-${id}`.
 */
export const bsReview = defineType({
  name: 'bsReview',
  title: 'B&S Review',
  type: 'document',
  fields: [
    defineField({ name: 'buildsellSiteId', title: 'Build & Sell Site ID', type: 'string', description: 'Postgres buildsell_sites.id this review belongs to.' }),
    defineField({ name: 'author', title: 'Author', type: 'string' }),
    defineField({ name: 'rating', title: 'Rating', type: 'number', validation: (r) => r.min(1).max(5) }),
    defineField({
      name: 'text',
      title: 'Review Text',
      type: 'text',
      rows: 4,
      description: 'Claude-written representative testimonial. NEVER paste verbatim Google review text.',
    }),
    defineField({ name: 'featured', title: 'Featured', type: 'boolean', initialValue: false }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
  ],
  preview: {
    select: { author: 'author', rating: 'rating' },
    prepare: ({ author, rating }) => ({ title: author ?? '(unnamed)', subtitle: `${rating ?? '?'}/5` }),
  },
});
