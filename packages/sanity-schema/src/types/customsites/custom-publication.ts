import { defineType, defineField } from 'sanity';

/**
 * A publication, article, or presentation credited to an attorney on the
 * Custom Site. `kind: 'article'` is an on-site post authored with `body`;
 * `'publication'`/`'presentation'` are external works, described with the
 * `external*` metadata fields and often no `body`. Deterministic id
 * `cs-pub-${siteKey}-${slug}`.
 *
 * `wpId`/`legacyPath` are provenance-only fields carried over from the
 * WordPress migration — read-only, not authored in Studio.
 */
export const csPublication = defineType({
  name: 'csPublication',
  title: 'Publication',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' }, validation: (r) => r.required() }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Article (on-site post)', value: 'article' },
          { title: 'Publication (external work)', value: 'publication' },
          { title: 'Presentation (external work)', value: 'presentation' },
        ],
        layout: 'radio',
      },
      initialValue: 'article',
      description: 'Articles are on-site posts with a full body. Publication/presentation are external works listed with event metadata (externalEvent/externalDate) instead of a full body.',
    }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'text', rows: 3 }),
    defineField({ name: 'body', title: 'Body', type: 'csBody', description: 'Optional — external publications/presentations may have no on-site body.' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime', validation: (r) => r.required() }),
    defineField({ name: 'modifiedAt', title: 'Modified At', type: 'datetime' }),
    defineField({ name: 'externalEvent', title: 'External Event / Publication Name', type: 'string', description: 'e.g. "Dispute Resolution Journal".' }),
    defineField({ name: 'externalDate', title: 'External Date', type: 'string', description: 'Human-readable date, e.g. "October 2, 2003".' }),
    defineField({ name: 'coAuthors', title: 'Co-Authors', type: 'string' }),
    defineField({ name: 'pdf', title: 'PDF', type: 'file' }),
    defineField({
      name: 'featuredImage',
      title: 'Featured Image',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string' })],
    }),
    defineField({ name: 'author', title: 'Author', type: 'reference', to: [{ type: 'csAttorney' }] }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo' }),
    defineField({ name: 'wpId', title: 'WordPress ID', type: 'number', readOnly: true, description: 'Provenance only — original WordPress post ID from the migration.' }),
    defineField({ name: 'legacyPath', title: 'Legacy Path', type: 'string', readOnly: true, description: 'Provenance only — original WordPress URL path, used to seed csRedirect entries.' }),
  ],
  preview: {
    select: { title: 'title', kind: 'kind', media: 'featuredImage' },
    prepare: ({ title, kind, media }) => ({ title: title ?? '(untitled)', subtitle: kind, media }),
  },
});
