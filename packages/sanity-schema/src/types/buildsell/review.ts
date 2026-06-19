import { defineType, defineField } from 'sanity';

/**
 * Build & Sell review document. Referenceable, featurable, sortable.
 *
 * ToS GUARD: this holds Claude-written REPRESENTATIVE testimonial copy
 * derived from business name + category + city only. It must NEVER contain
 * verbatim Google review text. The aggregate star rating is shown via
 * `bsReviewsSection.showRating`; individual review text here is original copy.
 *
 * `source` is a PRESENTATION LABEL only (e.g. "Verified Customer"). It describes
 * the display style of the review card, not the literal provenance. NEVER set
 * `source:'google'` on a Claude-generated testimonial — doing so would misrepresent
 * AI copy as a real Google review and violates Google's ToS and our brand policy.
 * The only safe values for generated testimonials are `'manual'` (default) and
 * `'facebook'` if the review style should render with a Facebook badge.
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
    defineField({
      name: 'avatar',
      title: 'Avatar',
      type: 'image',
      options: { hotspot: true },
      description: 'Optional reviewer avatar image.',
    }),
    defineField({ name: 'initials', title: 'Initials', type: 'string', description: 'e.g. "J.M." — shown when no avatar.' }),
    defineField({ name: 'location', title: 'Location', type: 'string', description: 'e.g. "Austin, TX".' }),
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
      options: {
        list: [
          { title: 'Manual (default)', value: 'manual' },
          { title: 'Facebook', value: 'facebook' },
          { title: 'Google', value: 'google' },
        ],
      },
      initialValue: 'manual',
      description: 'Presentation label only. NEVER set to "google" on a Claude-generated testimonial (ToS guard — see file header).',
    }),
    defineField({ name: 'date', title: 'Date', type: 'string', description: 'Display date string, e.g. "March 2024".' }),
  ],
  preview: {
    select: { author: 'author', rating: 'rating' },
    prepare: ({ author, rating }) => ({ title: author ?? '(unnamed)', subtitle: `${rating ?? '?'}/5` }),
  },
});
