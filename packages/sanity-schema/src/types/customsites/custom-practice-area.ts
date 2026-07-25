import { defineType, defineField } from 'sanity';

/**
 * One practice area (service) offered by the Custom Site, e.g. "Construction
 * Mediation", "Arbitration". Deterministic id `cs-pa-${siteKey}-${slug}`.
 */
export const csPracticeArea = defineType({
  name: 'csPracticeArea',
  title: 'Practice Area',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'title', title: 'Title', type: 'string', description: 'Plain text — no <br> or markup.', validation: (r) => r.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' }, validation: (r) => r.required() }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3 }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string' })],
    }),
    defineField({
      name: 'cardImage',
      title: 'Card Image',
      type: 'image',
      options: { hotspot: true },
      description: 'Image shown on the practice-area option card in csPracticeGridBlock.',
    }),
    defineField({ name: 'body', title: 'Body', type: 'csBody' }),
    defineField({ name: 'faqs', title: 'FAQs', type: 'array', of: [{ type: 'csFaqItem' }] }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
    defineField({ name: 'modifiedAt', title: 'Modified At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title', media: 'cardImage', site: 'site.name' },
    prepare: ({ title, media, site }) => ({ title: title ?? '(untitled)', subtitle: site, media }),
  },
});
