import { defineType, defineField } from 'sanity';

export const page = defineType({
  name: 'page',
  title: 'Page',
  type: 'document',
  fields: [
    defineField({
      name: 'site',
      title: 'Site',
      type: 'reference',
      to: [{ type: 'site' }],
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Home', value: 'home' },
          { title: 'About', value: 'about' },
          { title: 'Contact', value: 'contact' },
          { title: 'Service', value: 'service' },
          { title: 'Service Area', value: 'service_area' },
          { title: 'Blog', value: 'blog' },
          { title: 'Info', value: 'info' },
          { title: 'FAQ', value: 'faq' },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'string',
      description: 'URL slug. May include leading slash for kind=home (e.g. "/" or "junk-removal").',
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
      name: 'mdx',
      title: 'Body (MDX / Markdown)',
      type: 'text',
      rows: 20,
    }),
    defineField({
      name: 'jsonLd',
      title: 'Schema.org JSON-LD',
      type: 'text',
      description: 'Raw JSON. Rendered into <script type="application/ld+json"> by site-host.',
      rows: 8,
    }),
    defineField({
      name: 'pageOgImage',
      title: 'OG Image Override',
      type: 'image',
      options: { hotspot: true },
      description: 'Per-page Open Graph image. Falls back to site hero image when absent.',
    }),
    defineField({
      name: 'articleImage',
      title: 'Article Image',
      type: 'image',
      options: { hotspot: true },
      description:
        'Primary image for blog / info (Article) JSON-LD `image` — required for article rich-result eligibility. Generated per-page at build time; falls back to OG/hero image when absent.',
    }),
    defineField({
      name: 'articleImageAlt',
      title: 'Article Image Alt Text',
      type: 'string',
      description:
        'Alt text for articleImage — a literal description of the image (not the page topic), for screen readers and image SEO.',
    }),
    defineField({
      name: 'dateModified',
      title: 'Date Modified',
      type: 'datetime',
      description:
        'Last meaningful content update, emitted as Article `dateModified`. Set by the pipeline on (re)generation; falls back to the site generatedAt when absent.',
    }),
    defineField({
      name: 'primaryKeyword',
      title: 'Primary Keyword',
      type: 'string',
      description:
        'Denormalized from keywordCluster.primaryKeyword. The single phrase this page targets. Set by Content Engine via persist-sanity.',
    }),
    defineField({
      name: 'faqs',
      title: 'FAQs',
      type: 'array',
      description:
        'Q&A pairs rendered as a visible FAQ section + FAQPage JSON-LD on service / service-area pages. Set by Content Engine. Must be locally specific and varied per site (footprint).',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'q', title: 'Question', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'a', title: 'Answer', type: 'text', rows: 3, validation: (r) => r.required() }),
          ],
          preview: {
            select: { title: 'q' },
            prepare: ({ title }) => ({ title: title ?? '(no question)' }),
          },
        },
      ],
    }),
    defineField({
      name: 'targetedKeywords',
      title: 'Targeted Keywords',
      type: 'array',
      description:
        'Keywords Content Engine declared this page targets. Source of truth for "what should this page rank for" — joined against GSC reality by Phase 4 SEO Operator.',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'phrase', title: 'Phrase', type: 'string', validation: (r) => r.required() }),
            defineField({
              name: 'role',
              title: 'Role',
              type: 'string',
              options: { list: ['primary', 'secondary', 'supporting'] },
            }),
            defineField({
              name: 'clusterKey',
              title: 'Cluster Key',
              type: 'string',
              description: 'Which keywordCluster this came from. Useful for re-target lookups.',
            }),
          ],
          preview: {
            select: { title: 'phrase', role: 'role' },
            prepare: ({ title, role }) => ({ title: title ?? '(no phrase)', subtitle: role }),
          },
        },
      ],
    }),
  ],
  preview: {
    select: { title: 'title', kind: 'kind', siteName: 'site.businessName' },
    prepare: ({ title, kind, siteName }) => ({
      title: title ?? '(untitled)',
      subtitle: `${kind ?? '?'}${siteName ? ` · ${siteName}` : ''}`,
    }),
  },
});
