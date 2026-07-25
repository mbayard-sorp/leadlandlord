import { defineType, defineField } from 'sanity';

/**
 * An affiliation/award badge (bar association, AV rating, etc.) on the
 * Custom Site. Referenced from csBadgeRowBlock. Deterministic id
 * `cs-badge-${siteKey}-${key}`.
 */
export const csBadge = defineType({
  name: 'csBadge',
  title: 'Badge',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'image',
      title: 'Image',
      type: 'image',
      options: { hotspot: true },
      validation: (r) => r.required(),
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string' })],
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
  ],
  preview: {
    select: { title: 'name', media: 'image' },
    prepare: ({ title, media }) => ({ title: title ?? '(unnamed)', media }),
  },
});
