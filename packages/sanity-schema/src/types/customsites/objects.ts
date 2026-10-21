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
    defineField({
      name: 'noindex',
      title: 'Noindex',
      type: 'boolean',
      initialValue: false,
      description: 'Page-level noindex override, e.g. a disclaimer page. The site-wide default is csSite.robotsDisallow — this only overrides a single page.',
    }),
    defineField({
      name: 'canonicalOverride',
      title: 'Canonical Override',
      type: 'url',
      description: 'Explicit canonical URL when this page should point elsewhere, e.g. a legal publication that is a cross-post of a syndicated original.',
    }),
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

/**
 * A single non-bar-admission credential on csAttorney.credentials (AAA/ICC
 * certifications, judicial-reference appointments, etc.). Feeds
 * `hasCredential` JSON-LD generically.
 */
export const csCredential = defineType({
  name: 'csCredential',
  title: 'Credential',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'issuer', title: 'Issuer', type: 'string' }),
    defineField({ name: 'year', title: 'Year', type: 'number' }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'issuer' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '(unnamed)', subtitle }),
  },
});

/**
 * A single bar admission on csAttorney.barAdmissions. Kept structured
 * (rather than a plain string like credentials predates) because
 * jurisdiction is the sub-value most useful to query independently when
 * mapping to schema.org `hasCredential` (`credentialCategory: 'license'` +
 * `recognizedBy`).
 */
export const csBarAdmission = defineType({
  name: 'csBarAdmission',
  title: 'Bar Admission',
  type: 'object',
  fields: [
    defineField({ name: 'jurisdiction', title: 'Jurisdiction', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'barNumber', title: 'Bar Number', type: 'string' }),
    defineField({ name: 'admittedYear', title: 'Admitted Year', type: 'number' }),
  ],
  preview: {
    select: { title: 'jurisdiction', subtitle: 'barNumber' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '(unnamed)', subtitle }),
  },
});

/**
 * The two-pane device illustration used by csAppHeroBlock when no real device
 * render has been uploaded yet. Every string describes the actual app: the
 * outer pane is the prompter during a take, the inner pane is preflight.
 * It is a stylised illustration, not a screenshot, and it is replaced the
 * moment a photographed or 3D render exists.
 */
export const csFoldPreview = defineType({
  name: 'csFoldPreview',
  title: 'Fold Preview',
  type: 'object',
  fields: [
    defineField({ name: 'recordLabel', title: 'Record Label', type: 'string', initialValue: 'REC' }),
    defineField({ name: 'timecode', title: 'Timecode', type: 'string', initialValue: '00:42', description: 'Set in tabular numerals.' }),
    defineField({ name: 'pastLine', title: 'Outer: Past Line', type: 'text', rows: 2, description: 'Dimmed to 30% on the outer screen.' }),
    defineField({ name: 'currentLine', title: 'Outer: Current Line', type: 'text', rows: 2, description: 'The line being read, at full strength.' }),
    defineField({ name: 'lensNote', title: 'Outer: Lens Note', type: 'string', initialValue: '48MP · look here' }),
    defineField({ name: 'innerEyebrow', title: 'Inner: Eyebrow', type: 'string', initialValue: 'Preflight' }),
    defineField({ name: 'innerHeading', title: 'Inner: Heading', type: 'string' }),
    defineField({
      name: 'checklist',
      title: 'Inner: Checklist',
      type: 'array',
      of: [{ type: 'string' }],
      validation: (r) => r.max(3),
      description: 'Up to three preflight lines.',
    }),
    defineField({ name: 'primaryLabel', title: 'Inner: Primary Button', type: 'string' }),
    defineField({ name: 'secondaryLabel', title: 'Inner: Secondary Button', type: 'string' }),
    defineField({
      name: 'viewfinder',
      title: 'Viewfinder Photo',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() })],
      description:
        'When set, the preview renders the camera variant instead of the preflight one: a photo pane with the REC overlay and a prompter pane showing the past, current and next lines. The Inner fields are ignored in this variant.',
    }),
    defineField({
      name: 'nextLine',
      title: 'Prompter: Next Line',
      type: 'text',
      rows: 2,
      description: 'Camera variant only. The line coming up, dimmed under the current line in the prompter pane.',
    }),
  ],
  preview: {
    select: { title: 'innerHeading', subtitle: 'currentLine', media: 'viewfinder' },
    prepare: ({ title, subtitle, media }) => ({ title: title ?? 'Fold preview', subtitle, media }),
  },
});

/**
 * One take card in csDeviceShowcaseBlock when its visual is "takes": a mock of
 * the app's library grid. An uploaded image turns the card into a photo
 * thumbnail; without one it is a plain tile.
 */
export const csShowcaseTake = defineType({
  name: 'csShowcaseTake',
  title: 'Showcase Take',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string', description: 'Take name, e.g. "Take 01" or "Intro".', validation: (r) => r.required() }),
    defineField({ name: 'duration', title: 'Duration', type: 'string', description: 'Set as shown in the app, e.g. "01:14".', validation: (r) => r.required() }),
    defineField({
      name: 'image',
      title: 'Thumbnail',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() })],
      description: 'Optional. A frame from the take. Without it the card renders as a plain tile.',
    }),
    defineField({ name: 'flag', title: 'Flag', type: 'string', description: 'Optional small tag on the card, e.g. "Latest".' }),
  ],
  preview: {
    select: { title: 'label', subtitle: 'duration', media: 'image' },
  },
});

/**
 * The editor mock used by csDeviceShowcaseBlock when its visual is "editor".
 * Every string describes the real in-app editor.
 */
export const csShowcaseEditor = defineType({
  name: 'csShowcaseEditor',
  title: 'Showcase Editor',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', description: 'The editor header, e.g. "Edit take".' }),
    defineField({ name: 'timecode', title: 'Timecode', type: 'string', description: 'Set in tabular numerals, e.g. "00:42".' }),
    defineField({
      name: 'image',
      title: 'Preview Frame',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() })],
      description: 'A frame from the take, used for the preview and the first clip on the timeline.',
    }),
    defineField({ name: 'range', title: 'Trim Range', type: 'string', description: 'Shown over the preview, e.g. "00:14 → 00:52".' }),
    defineField({ name: 'clipLabel', title: 'Clip Label', type: 'string', description: 'Name of the take clip on the timeline, e.g. "Take 3".' }),
    defineField({
      name: 'tracks',
      title: 'Timeline Tracks',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Up to four other clips on the timeline after the take, e.g. "Title", "Photo".',
      validation: (r) => r.max(4),
    }),
    defineField({
      name: 'tools',
      title: 'Toolbar',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Up to six toolbar buttons, e.g. "Trim", "Title", "Photo", "Transition".',
      validation: (r) => r.max(6),
    }),
    defineField({ name: 'doneLabel', title: 'Done Label', type: 'string', description: 'The confirm button, e.g. "Done".' }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'range', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({ title: title ?? 'Editor', subtitle, media }),
  },
});

/**
 * The record-countdown mock in csAppCtaBlock: a take label, a big digit and a
 * REC readout, set above the heading.
 */
export const csCountdown = defineType({
  name: 'csCountdown',
  title: 'Countdown',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Take label, e.g. "Take 03".' }),
    defineField({ name: 'digit', title: 'Digit', type: 'string', description: 'The big countdown number, e.g. "1".' }),
    defineField({ name: 'recLabel', title: 'Record Label', type: 'string', description: 'e.g. "REC".' }),
    defineField({ name: 'timecode', title: 'Timecode', type: 'string', description: 'Set in tabular numerals, e.g. "00:00".' }),
  ],
  preview: {
    select: { title: 'eyebrow', subtitle: 'digit' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Countdown', subtitle }),
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
  csCredential,
  csBarAdmission,
  csFoldPreview,
  csShowcaseTake,
  csShowcaseEditor,
  csCountdown,
];
