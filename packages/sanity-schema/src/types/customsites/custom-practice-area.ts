import { defineType, defineField } from 'sanity';
import { csSlugField } from './slug';

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
    csSlugField('title'),
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
    defineField({
      name: 'deliverables',
      title: 'Deliverables',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'The individual services inside this focus area. The count shown next to the title in csFocusAreaListBlock is the length of this list — do not type a number.',
    }),
    defineField({
      name: 'shortLabel',
      title: 'Short Label',
      type: 'string',
      description: 'Nav/rail label when the full title is too long.',
    }),
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
