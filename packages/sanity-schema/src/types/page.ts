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
  ],
  preview: {
    select: { title: 'title', kind: 'kind', siteName: 'site.businessName' },
    prepare: ({ title, kind, siteName }) => ({
      title: title ?? '(untitled)',
      subtitle: `${kind ?? '?'}${siteName ? ` · ${siteName}` : ''}`,
    }),
  },
});
