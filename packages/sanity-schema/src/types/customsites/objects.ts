import { defineType, defineField, defineArrayMember } from 'sanity';

/**
 * Custom Sites reusable object types. Every type is `cs`-prefixed so it can
 * never collide with the R&R or Build & Sell schemas in the shared dataset.
 * Custom Sites is the standalone client-owned lift-and-shift line (first
 * tenant: constructionadrservices.com).
 */

export const csSeo = defineType({
  name: 'csSeo',
  title: 'SEO',
  type: 'object',
  fields: [
    defineField({ name: 'metaTitle', title: 'Meta Title', type: 'string' }),
    defineField({ name: 'metaDescription', title: 'Meta Description', type: 'text', rows: 3 }),
    defineField({ name: 'ogImage', title: 'OG Image', type: 'image' }),
  ],
});

/**
 * Flat second-level nav link, used only inside csNavLink.children. Sanity
 * object types can't nest themselves recursively inside their own field
 * definitions, so the one dropdown level a nav needs is a separate flat type
 * rather than a self-reference.
 */
export const csNavChildLink = defineType({
  name: 'csNavChildLink',
  title: 'Nav Child Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({ name: 'href', title: 'Href', type: 'string' }),
  ],
  preview: { select: { title: 'label', subtitle: 'href' } },
});

export const csNavLink = defineType({
  name: 'csNavLink',
  title: 'Nav Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({ name: 'href', title: 'Href', type: 'string' }),
    defineField({
      name: 'children',
      title: 'Dropdown Children',
      type: 'array',
      of: [{ type: 'csNavChildLink' }],
      description: 'One-level dropdown shown under this top-level nav item. Leave empty for a plain link.',
    }),
  ],
  preview: { select: { title: 'label', subtitle: 'href' } },
});

export const csAddress = defineType({
  name: 'csAddress',
  title: 'Address',
  type: 'object',
  fields: [
    defineField({ name: 'street', title: 'Street', type: 'string' }),
    defineField({ name: 'unit', title: 'Unit / Suite', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State', type: 'string' }),
    defineField({ name: 'zip', title: 'ZIP', type: 'string' }),
  ],
  preview: { select: { title: 'street', subtitle: 'city' } },
});

/**
 * Inline object for a single FAQ item inside csPracticeArea.faqs.
 */
export const csFaqItem = defineType({
  name: 'csFaqItem',
  title: 'FAQ Item',
  type: 'object',
  fields: [
    defineField({ name: 'question', title: 'Question', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'answer', title: 'Answer', type: 'text', rows: 4, validation: (r) => r.required() }),
  ],
  preview: {
    select: { title: 'question' },
    prepare: ({ title }) => ({ title: title ?? '(question)' }),
  },
});

/**
 * Shared Portable Text body used for every rich body field across Custom
 * Sites doc types (practice areas, publications, attorney bios, rich text
 * blocks). Declared as a named `array` type (not inlined per-field) so the
 * WordPress-migration script can compile it standalone via `@sanity/schema`
 * when converting legacy HTML into Portable Text blocks.
 *
 * External links (`link` annotation) carry only `href` — `rel="noopener
 * noreferrer"` / target handling for external URLs is decided at render
 * time, not stored on the doc.
 */
export const csBody = defineType({
  name: 'csBody',
  title: 'Body',
  type: 'array',
  of: [
    defineArrayMember({
      type: 'block',
      styles: [
        { title: 'Normal', value: 'normal' },
        { title: 'Heading 2', value: 'h2' },
        { title: 'Heading 3', value: 'h3' },
        { title: 'Heading 4', value: 'h4' },
        { title: 'Quote', value: 'blockquote' },
      ],
      lists: [
        { title: 'Bullet', value: 'bullet' },
        { title: 'Number', value: 'number' },
      ],
      marks: {
        decorators: [
          { title: 'Bold', value: 'strong' },
          { title: 'Italic', value: 'em' },
        ],
        annotations: [
          defineArrayMember({
            name: 'link',
            type: 'object',
            title: 'Link',
            fields: [
              defineField({
                name: 'href',
                title: 'URL',
                type: 'url',
                description: 'Internal path or external URL. External rel/target handling is applied at render time.',
              }),
            ],
          }),
        ],
      },
    }),
    defineArrayMember({
      type: 'image',
      options: { hotspot: true },
      fields: [
        defineField({ name: 'alt', title: 'Alt Text', type: 'string' }),
        defineField({ name: 'caption', title: 'Caption', type: 'string' }),
      ],
    }),
  ],
});

/**
 * One legacy-URL → new-URL redirect entry on csSite.redirects.
 *
 * `from` and `to` are stored as paths WITHOUT a leading slash (e.g.
 * "old-practice-area" not "/old-practice-area"); the render/middleware
 * layer prepends the slash.
 */
export const csRedirect = defineType({
  name: 'csRedirect',
  title: 'Redirect',
  type: 'object',
  fields: [
    defineField({ name: 'from', title: 'From Path', type: 'string', description: 'Path without a leading slash, e.g. "old-page".' }),
    defineField({ name: 'to', title: 'To Path', type: 'string', description: 'Path without a leading slash, e.g. "new-page".' }),
  ],
  preview: {
    select: { from: 'from', to: 'to' },
    prepare: ({ from, to }) => ({ title: `${from ?? '?'} → ${to ?? '?'}` }),
  },
});

export const customSitesObjectTypes = [
  csSeo,
  csNavChildLink,
  csNavLink,
  csAddress,
  csFaqItem,
  csBody,
  csRedirect,
];
