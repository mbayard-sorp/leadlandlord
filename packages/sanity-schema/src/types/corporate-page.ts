import { defineType, defineField } from 'sanity';

/**
 * Page for the leadslandlord.com corporate marketing site. Distinct from
 * `page` (per-tenant) — shape is much simpler since corporate copy doesn't
 * need a niche/city/phone treatment.
 *
 * Deterministic id: `corporate-page-${kind}` (one doc per kind).
 */
export const corporatePage = defineType({
  name: 'corporatePage',
  title: 'Corporate Page',
  type: 'document',
  fields: [
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Home', value: 'home' },
          { title: 'Services', value: 'services' },
          { title: 'Pricing', value: 'pricing' },
          { title: 'About', value: 'about' },
          { title: 'Contact', value: 'contact' },
          { title: 'Privacy', value: 'privacy' },
          { title: 'Terms', value: 'terms' },
        ],
        layout: 'radio',
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      title: 'URL Slug',
      type: 'string',
      description: 'Without leading slash. Use "" for home.',
    }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'metaDescription',
      title: 'Meta Description',
      type: 'text',
      rows: 2,
    }),
    defineField({
      name: 'heroEyebrow',
      title: 'Hero Eyebrow',
      type: 'string',
      description: 'Short tag above the H1 (e.g. "Lead generation, done for you").',
    }),
    defineField({
      name: 'heroHeadline',
      title: 'Hero Headline',
      type: 'string',
      description: 'H1 on the page.',
    }),
    defineField({
      name: 'heroSubhead',
      title: 'Hero Subhead',
      type: 'text',
      rows: 3,
      description: 'Supporting text below H1.',
    }),
    defineField({
      name: 'mdx',
      title: 'Body (Markdown)',
      type: 'text',
      rows: 30,
      description: 'Long-form body. Rendered with the shared Markdown component.',
    }),
    defineField({
      name: 'jsonLd',
      title: 'Schema.org JSON-LD',
      type: 'text',
      rows: 8,
      description: 'Raw JSON. Rendered into <script type="application/ld+json">.',
    }),
  ],
  preview: {
    select: { title: 'title', kind: 'kind' },
    prepare: ({ title, kind }) => ({
      title: title ?? '(untitled)',
      subtitle: kind ?? '?',
    }),
  },
});
