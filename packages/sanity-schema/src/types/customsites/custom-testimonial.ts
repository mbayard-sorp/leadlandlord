import { defineType, defineField } from 'sanity';

/**
 * A client testimonial on the Custom Site. Referenced from csTestimonialsBlock.
 * Deterministic id `cs-testimonial-${siteKey}-${key}`.
 */
export const csTestimonial = defineType({
  name: 'csTestimonial',
  title: 'Testimonial',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'quote', title: 'Quote', type: 'text', rows: 4, validation: (r) => r.required() }),
    defineField({ name: 'author', title: 'Author', type: 'string' }),
    defineField({ name: 'role', title: 'Role', type: 'string', description: 'e.g. "General Contractor", "Owner\'s Counsel".' }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
    defineField({ name: 'featured', title: 'Featured', type: 'boolean', initialValue: false }),
  ],
  preview: {
    select: { title: 'author', subtitle: 'quote' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '(unnamed)', subtitle }),
  },
});
