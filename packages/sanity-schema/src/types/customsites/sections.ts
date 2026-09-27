import { defineType, defineField } from 'sanity';

/**
 * The Custom Sites page-builder blocks. They are members of
 * `csPage.pageBuilder[]` and render in array order. Each is `cs`-prefixed.
 *
 * Blocks 1-12 shipped with site #1 (constructionadrservices.com). The
 * aligned-advisors set (csStatRailBlock ... csDisclosureBlock) shipped with
 * site #2; they are line-generic, not site-specific — any custom site may use
 * any block.
 */

export const csHeroBlock = defineType({
  name: 'csHeroBlock',
  title: 'Hero',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'headingEmphasis',
      title: 'Heading Emphasis',
      type: 'string',
      description:
        'Optional. A phrase from the Heading above to set in brass, e.g. "Freedom Plan". It must appear in the Heading verbatim; leave empty for a single-color headline.',
      validation: (r) =>
        r
          .custom((value, context) => {
            if (typeof value !== 'string' || !value.trim()) return true;
            const heading = (context.parent as { heading?: unknown } | undefined)?.heading;
            if (typeof heading !== 'string' || !heading) return true;
            return heading.toLowerCase().includes(value.trim().toLowerCase())
              ? true
              : 'This phrase is not in the Heading, so nothing will be emphasized.';
          })
          .warning(),
    }),
    defineField({ name: 'subheading', title: 'Subheading', type: 'text', rows: 2 }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
    defineField({
      name: 'backgroundImage',
      title: 'Background Image',
      type: 'image',
      options: { hotspot: true },
      description:
        'Shown behind the headline. Also used as the poster frame for a Background Video, and as what reduced-motion visitors see instead of the video — set it even when a video is uploaded.',
    }),
    defineField({
      name: 'backgroundVideo',
      title: 'Background Video',
      type: 'file',
      options: { accept: 'video/mp4,video/webm' },
      description:
        'Optional short silent loop that plays over the Background Image. Keep it to 5-15 seconds and under ~5 MB — it downloads on every visit. MP4 (H.264) is the safest format. Audio is never played.',
    }),
  ],
  preview: {
    select: { title: 'heading', media: 'backgroundImage', video: 'backgroundVideo.asset' },
    prepare: ({ title, media, video }) => ({
      title: `Hero — ${title ?? ''}`,
      subtitle: video ? 'Video background' : undefined,
      media,
    }),
  },
});

export const csIntroBlock = defineType({
  name: 'csIntroBlock',
  title: 'Intro',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'body', title: 'Body', type: 'csBody' }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: { list: [{ title: 'Split (heading left, body right)', value: 'split' }, { title: 'Stacked (heading above full-width body)', value: 'stacked' }] },
      initialValue: 'split',
    }),
    defineField({
      name: 'bodyDividers',
      title: 'Rule line between paragraphs',
      type: 'boolean',
      description: 'Stacked layout only. Draws a hairline rule between body paragraphs.',
      initialValue: false,
    }),
    defineField({
      name: 'topRule',
      title: 'Rule line above block',
      type: 'boolean',
      description: 'Stacked layout only. Draws a hairline rule above the block, e.g. a closing note below a grid.',
      initialValue: false,
    }),
  ],
  preview: { select: { title: 'heading' }, prepare: ({ title }) => ({ title: title ? `Intro — ${title}` : 'Intro' }) },
});

export const csPracticeGridBlock = defineType({
  name: 'csPracticeGridBlock',
  title: 'Practice Areas Grid',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'mode',
      title: 'Mode',
      type: 'string',
      options: {
        list: [
          { title: 'All practice areas', value: 'all' },
          { title: 'Selected practice areas', value: 'selected' },
        ],
        layout: 'radio',
      },
      initialValue: 'all',
      description: '"All" lists every csPracticeArea for this site. "Selected" renders only the Areas picked below, in that order.',
    }),
    defineField({
      name: 'areas',
      title: 'Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csPracticeArea' }] }],
      description: 'Ignored when Mode is "All". Populate to hand-pick and order a subset.',
    }),
  ],
  preview: { select: { title: 'heading', mode: 'mode' }, prepare: ({ title, mode }) => ({ title: title ? `Practice Grid — ${title}` : 'Practice Grid', subtitle: mode }) },
});

export const csAttorneyBlock = defineType({
  name: 'csAttorneyBlock',
  title: 'Attorney',
  type: 'object',
  fields: [
    defineField({ name: 'attorney', title: 'Attorney', type: 'reference', to: [{ type: 'csAttorney' }] }),
    defineField({
      name: 'showFullProfile',
      title: 'Show Full Profile',
      type: 'boolean',
      description: 'On the profile page, render the attorney bio sections (Practice Areas, Experience, Education, etc.) below the summary. Off = summary + link, for home-page use.',
      initialValue: false,
    }),
  ],
  preview: { select: { title: 'attorney.name' }, prepare: ({ title }) => ({ title: title ? `Attorney — ${title}` : 'Attorney' }) },
});

export const csTestimonialsBlock = defineType({
  name: 'csTestimonialsBlock',
  title: 'Testimonials',
  type: 'object',
  fields: [
    defineField({
      name: 'items',
      title: 'Testimonials',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csTestimonial' }] }],
    }),
    defineField({ name: 'autoRotate', title: 'Auto-rotate', type: 'boolean', initialValue: false }),
  ],
  preview: { prepare: () => ({ title: 'Testimonials' }) },
});

export const csBadgeRowBlock = defineType({
  name: 'csBadgeRowBlock',
  title: 'Badge Row',
  type: 'object',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      description: 'Small label above the row, e.g. "COMPANIES THAT TRUST US". Leave empty for a bare logo strip.',
    }),
    defineField({
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description: 'Optional heading. Leave empty for a bare logo strip.',
    }),
    defineField({
      name: 'badges',
      title: 'Badges',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csBadge' }] }],
    }),
    defineField({
      name: 'scroll',
      title: 'Scroll continuously',
      type: 'boolean',
      description:
        'Slides the logos past in a loop instead of a static centered row. Worth it from about 5 logos up — below that the strip is mostly empty gap. It pauses on hover and holds still for reduced-motion visitors.',
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: 'heading', eyebrow: 'eyebrow', scroll: 'scroll' },
    prepare: ({ title, eyebrow, scroll }) => ({
      title: title ?? eyebrow ?? 'Badge Row',
      subtitle: scroll ? 'Scrolling logo strip' : undefined,
    }),
  },
});

export const csPublicationsBlock = defineType({
  name: 'csPublicationsBlock',
  title: 'Publications',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'limit', title: 'Limit', type: 'number', description: 'Max number of publications to list, most recent first.' }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
  ],
  preview: { select: { title: 'heading' }, prepare: ({ title }) => ({ title: title ? `Publications — ${title}` : 'Publications' }) },
});

export const csCalloutBlock = defineType({
  name: 'csCalloutBlock',
  title: 'Callout',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({ name: 'quote', title: 'Quote', type: 'text', rows: 3 }),
    defineField({ name: 'linkLabel', title: 'Link Label', type: 'string' }),
    defineField({ name: 'linkHref', title: 'Link Href', type: 'string' }),
  ],
  preview: { select: { title: 'label', subtitle: 'quote' }, prepare: ({ title, subtitle }) => ({ title: title ? `Callout — ${title}` : 'Callout', subtitle }) },
});

export const csRichTextBlock = defineType({
  name: 'csRichTextBlock',
  title: 'Rich Text',
  type: 'object',
  fields: [
    defineField({ name: 'content', title: 'Content', type: 'csBody' }),
  ],
  preview: { prepare: () => ({ title: 'Rich Text' }) },
});

export const csContactCtaBlock = defineType({
  name: 'csContactCtaBlock',
  title: 'Contact CTA',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'body', title: 'Body', type: 'text', rows: 3 }),
    defineField({ name: 'showForm', title: 'Show Lead Form', type: 'boolean', initialValue: true }),
    defineField({
      name: 'formVariant',
      title: 'Form Variant',
      type: 'string',
      options: {
        list: [
          { title: 'Standard (name / email / phone / message)', value: 'standard' },
          { title: 'Consultation (adds call-type choices)', value: 'consultation' },
        ],
        layout: 'radio',
      },
      initialValue: 'standard',
      description: '"Consultation" adds the call-type checkbox group (Goal / Tax / Practice Profitability / Other). "Standard" is the shared name/email/phone/message set.',
    }),
    defineField({
      name: 'formFootnote',
      title: 'Form Footnote',
      type: 'text',
      rows: 2,
      description: 'Fine print under the submit button, e.g. the complimentary/no-obligation line.',
    }),
    defineField({
      name: 'checklist',
      title: 'Checklist',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csContactChecklistItem',
          title: 'Checklist Item',
          fields: [
            defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'body', title: 'Body', type: 'text', rows: 2 }),
          ],
          preview: { select: { title: 'heading' } },
        },
      ],
      validation: (r) => r.max(4),
      description: '"Here’s what we’ll cover" items shown beside the form.',
    }),
  ],
  preview: { select: { title: 'heading' }, prepare: ({ title }) => ({ title: title ? `Contact CTA — ${title}` : 'Contact CTA' }) },
});

export const csCtaBannerBlock = defineType({
  name: 'csCtaBannerBlock',
  title: 'CTA Banner',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
  ],
  preview: { select: { title: 'heading' }, prepare: ({ title }) => ({ title: title ? `CTA Banner — ${title}` : 'CTA Banner' }) },
});

/**
 * A standalone FAQ surface for any csPage, wrapping the existing csFaqItem
 * type (previously reachable only from csPracticeArea.faqs). Lets a generic
 * page (e.g. a standalone "Why Arbitration" page) carry FAQPage JSON-LD
 * content. csPracticeArea.faqs is unrelated and unchanged.
 */
export const csFaqBlock = defineType({
  name: 'csFaqBlock',
  title: 'FAQ',
  type: 'object',
  fields: [
    defineField({
      name: 'heading',
      title: 'Heading',
      type: 'string',
      description: 'Defaults to "Frequently Asked Questions" at render time when left empty.',
    }),
    defineField({ name: 'items', title: 'Items', type: 'array', of: [{ type: 'csFaqItem' }] }),
  ],
  preview: {
    select: { title: 'heading' },
    prepare: ({ title }) => ({ title: title ? `FAQ — ${title}` : 'FAQ' }),
  },
});

/* ── Aligned Advisors set (site #2) — line-generic blocks ─────────────────── */

export const csStatRailBlock = defineType({
  name: 'csStatRailBlock',
  title: 'Stat Rail',
  type: 'object',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      description: 'Framing label, e.g. "SERVING DENTISTS SINCE 2008".',
    }),
    defineField({
      name: 'items',
      title: 'Stats',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csStatItem',
          title: 'Stat',
          fields: [
            defineField({
              name: 'value',
              title: 'Value',
              type: 'string',
              validation: (r) => r.required(),
              description: 'Author-entered text so "400+", "$1.2B+" and "93%" all work.',
            }),
            defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
            defineField({
              name: 'footnote',
              title: 'Footnote',
              type: 'string',
              description: 'The qualifier a compliance review will ask for. Any dollar-volume claim should carry one.',
            }),
          ],
          preview: { select: { title: 'value', subtitle: 'label' } },
        },
      ],
      validation: (r) => r.min(2).max(4),
    }),
    defineField({
      name: 'inverse',
      title: 'Inverse (dark band)',
      type: 'boolean',
      initialValue: false,
      description: 'Render on the dark band instead of paper.',
    }),
  ],
  preview: {
    select: { title: 'eyebrow', items: 'items' },
    prepare: ({ title, items }) => ({
      title: title ?? 'Stat Rail',
      subtitle: `${Array.isArray(items) ? items.length : 0} stats`,
    }),
  },
});

export const csValuePropsBlock = defineType({
  name: 'csValuePropsBlock',
  title: 'Value Props (3 or 4 up)',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csValuePropItem',
          title: 'Value Prop',
          fields: [
            defineField({
              name: 'icon',
              title: 'Icon',
              type: 'string',
              options: {
                list: [
                  'team',
                  'practice',
                  'roadmap',
                  'shield',
                  'chart',
                  'clock',
                  'cueduo/fold',
                  'cueduo/eyeline',
                  'cueduo/cut',
                  'cueduo/pace',
                ],
              },
              description: 'Chooses one of the site’s built-in inline SVG icons. Not an upload — icons ship with the code so they inherit color and stay crisp.',
            }),
            defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'body', title: 'Body', type: 'text', rows: 3, validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'heading', subtitle: 'icon' } },
        },
      ],
      // Relaxed from 3 to 4 for site #3, which has four brand features. The
      // grid is auto-fit, so three-item sites are unaffected.
      validation: (r) => r.min(2).max(4),
    }),
    defineField({
      name: 'backgroundImage',
      title: 'Background Image',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string' })],
      description:
        'Optional photo behind the whole section. The section flips to light-on-dark over a scrim when one is set, so pick something with room for text — a busy or light image will fight the copy. Leave empty for the plain paper background.',
    }),
  ],
  preview: {
    select: { title: 'heading', items: 'items', media: 'backgroundImage' },
    prepare: ({ title, items, media }) => ({
      title: title ?? 'Value Props',
      subtitle: `${Array.isArray(items) ? items.length : 0} props`,
      media,
    }),
  },
});

export const csJourneyBlock = defineType({
  name: 'csJourneyBlock',
  title: 'Wealth Journey',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'intro', title: 'Intro', type: 'text', rows: 3 }),
    defineField({
      name: 'stages',
      title: 'Stages',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csJourneyStage' }] }],
      validation: (r) => r.min(3).max(6),
      description: 'The journey stages, in order. Reorder here to change the rail.',
    }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
  ],
  preview: {
    select: { title: 'heading', stages: 'stages' },
    prepare: ({ title, stages }) => ({
      title: title ? `Journey — ${title}` : 'Wealth Journey',
      subtitle: `${Array.isArray(stages) ? stages.length : 0} stages`,
    }),
  },
});

export const csCompareBlock = defineType({
  name: 'csCompareBlock',
  title: 'Comparison Rows',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'intro', title: 'Intro', type: 'text', rows: 2 }),
    defineField({
      name: 'leftLabel',
      title: 'Left Label',
      type: 'string',
      initialValue: 'Traditional',
      description: 'Column label prefix for the "them" side; each row can override it via its own Who line.',
    }),
    defineField({ name: 'rightLabel', title: 'Right Label', type: 'string' }),
    defineField({
      name: 'rows',
      title: 'Rows',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csCompareRow',
          title: 'Comparison Row',
          fields: [
            defineField({
              name: 'leftWho',
              title: 'Left Who',
              type: 'string',
              validation: (r) => r.required(),
              description: 'e.g. "TRADITIONAL BOOKKEEPER".',
            }),
            defineField({ name: 'leftQuote', title: 'Left Quote', type: 'text', rows: 2, validation: (r) => r.required() }),
            defineField({ name: 'rightQuote', title: 'Right Quote', type: 'text', rows: 2, validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'leftWho', subtitle: 'rightQuote' } },
        },
      ],
      validation: (r) => r.min(2).max(8),
    }),
  ],
  preview: {
    select: { title: 'heading', rows: 'rows' },
    prepare: ({ title, rows }) => ({
      title: title ?? 'Comparison Rows',
      subtitle: `${Array.isArray(rows) ? rows.length : 0} comparisons`,
    }),
  },
});

export const csTeamGridBlock = defineType({
  name: 'csTeamGridBlock',
  title: 'Team Grid',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'intro', title: 'Intro', type: 'text', rows: 2 }),
    defineField({
      name: 'mode',
      title: 'Mode',
      type: 'string',
      options: {
        list: [
          { title: 'All team members', value: 'all' },
          { title: 'Selected team members', value: 'selected' },
        ],
        layout: 'radio',
      },
      initialValue: 'all',
    }),
    defineField({
      name: 'members',
      title: 'Members',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csAttorney' }] }],
      description: 'Only used when Mode is "Selected". Order here is the display order.',
    }),
    defineField({
      name: 'linkToProfiles',
      title: 'Link to Profiles',
      type: 'boolean',
      initialValue: true,
      description: 'Off for a non-clickable roster (use when bios aren’t written yet).',
    }),
  ],
  preview: {
    select: { title: 'heading', mode: 'mode' },
    prepare: ({ title, mode }) => ({ title: title ?? 'Team Grid', subtitle: mode }),
  },
});

export const csFocusAreaListBlock = defineType({
  name: 'csFocusAreaListBlock',
  title: 'Focus Area List (numbered)',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'summaryLine',
      title: 'Summary Line',
      type: 'string',
      description: 'The one-line total, e.g. "80+ services, 187 deliverable checkpoints across 7 coordinated focus areas." Author-maintained; it is not computed.',
    }),
    defineField({
      name: 'areas',
      title: 'Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csPracticeArea' }] }],
      validation: (r) => r.min(1),
    }),
    defineField({
      name: 'showDeliverableCounts',
      title: 'Show Deliverable Counts',
      type: 'boolean',
      initialValue: true,
      description: 'Shows the count of each area’s Deliverables list next to its title.',
    }),
  ],
  preview: {
    select: { title: 'heading', areas: 'areas' },
    prepare: ({ title, areas }) => ({
      title: title ?? 'Focus Area List',
      subtitle: `${Array.isArray(areas) ? areas.length : 0} areas`,
    }),
  },
});

export const csCaseStudyGridBlock = defineType({
  name: 'csCaseStudyGridBlock',
  title: 'Case Study Grid',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'mode',
      title: 'Mode',
      type: 'string',
      options: {
        list: [
          { title: 'All case studies', value: 'all' },
          { title: 'Selected case studies', value: 'selected' },
        ],
        layout: 'radio',
      },
      initialValue: 'all',
    }),
    defineField({
      name: 'items',
      title: 'Case Studies',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csCaseStudy' }] }],
      description: 'Only used when Mode is "Selected".',
    }),
    defineField({
      name: 'limit',
      title: 'Limit',
      type: 'number',
      initialValue: 3,
      validation: (r) => r.min(1).max(9),
    }),
    defineField({
      name: 'disclaimer',
      title: 'Disclaimer',
      type: 'text',
      rows: 3,
      description: 'Shown once beneath the grid. Required whenever any card shows a dollar or percentage figure.',
    }),
  ],
  preview: {
    select: { title: 'heading', mode: 'mode' },
    prepare: ({ title, mode }) => ({ title: title ?? 'Case Study Grid', subtitle: mode }),
  },
});

export const csNumbersIqBlock = defineType({
  name: 'csNumbersIqBlock',
  title: 'NumbersIQ Callout',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'body', title: 'Body', type: 'csBody' }),
    defineField({
      name: 'metrics',
      title: 'Metrics',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csNumbersIqMetric',
          title: 'Metric',
          fields: [
            defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
            defineField({
              name: 'percent',
              title: 'Percent',
              type: 'number',
              validation: (r) => r.required().min(0).max(100),
              description: 'Fill level of the benchmark meter, 0–100. This is an illustration of the product, not live client data.',
            }),
            defineField({
              name: 'valueLabel',
              title: 'Value Label',
              type: 'string',
              description: 'Text shown at the end of the meter, e.g. "62nd pctl".',
            }),
          ],
          preview: { select: { title: 'label', subtitle: 'valueLabel' } },
        },
      ],
      validation: (r) => r.max(5),
    }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string', initialValue: 'Explore NumbersIQ' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'url', initialValue: 'https://numbersiq.com' }),
    defineField({
      name: 'illustrative',
      title: 'Illustrative',
      type: 'boolean',
      initialValue: true,
      description: 'Prints "Illustrative" next to the meters. Leave on unless the figures are a real, signed-off benchmark set.',
    }),
  ],
  preview: {
    select: { title: 'heading', metrics: 'metrics' },
    prepare: ({ title, metrics }) => ({
      title: title ? `NumbersIQ — ${title}` : 'NumbersIQ Callout',
      subtitle: `${Array.isArray(metrics) ? metrics.length : 0} metrics`,
    }),
  },
});

export const csLeadMagnetBlock = defineType({
  name: 'csLeadMagnetBlock',
  title: 'Lead Magnet Cards',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'intro',
      title: 'Intro',
      type: 'text',
      rows: 2,
      description: 'Optional sentence under the heading, e.g. what the reports cover and where the data comes from.',
    }),
    defineField({
      name: 'formFootnote',
      title: 'Form Footnote',
      type: 'string',
      description:
        'Optional reassurance under the gated form, e.g. "No spam — just the report and occasional insights." Only shown on cards that ask for an email.',
    }),
    defineField({
      name: 'items',
      title: 'Reports',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csLeadMagnetItem',
          title: 'Report',
          fields: [
            defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'body', title: 'Body', type: 'text', rows: 3, validation: (r) => r.required() }),
            defineField({
              name: 'pdf',
              title: 'PDF',
              type: 'file',
              options: { accept: 'application/pdf' },
              validation: (r) => r.required(),
            }),
            defineField({
              name: 'gated',
              title: 'Gated',
              type: 'boolean',
              initialValue: true,
              description: 'Gated asks for name + email before the download link is emailed. Ungated links straight to the PDF.',
            }),
            defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string', initialValue: 'Get the report' }),
          ],
          preview: { select: { title: 'title' } },
        },
      ],
      validation: (r) => r.min(1).max(3),
    }),
  ],
  preview: {
    select: { title: 'heading', items: 'items' },
    prepare: ({ title, items }) => ({
      title: title ?? 'Lead Magnet Cards',
      subtitle: `${Array.isArray(items) ? items.length : 0} reports`,
    }),
  },
});

export const csTabbedInsightsBlock = defineType({
  name: 'csTabbedInsightsBlock',
  title: 'Insights Tabs',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({
      name: 'tabs',
      title: 'Tabs',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csInsightsTab',
          title: 'Tab',
          fields: [
            defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'sublabel', title: 'Sublabel', type: 'string' }),
            defineField({
              name: 'href',
              title: 'Href',
              type: 'string',
              validation: (r) => r.required(),
              description: 'Route for this tab, e.g. /insights or /insights/speaking. Tabs are links to real pages, not JS panels — each is separately shareable.',
            }),
            defineField({
              name: 'icon',
              title: 'Icon',
              type: 'string',
              options: { list: ['podcast', 'mic', 'doc'] },
            }),
          ],
          preview: { select: { title: 'label', subtitle: 'href' } },
        },
      ],
      validation: (r) => r.min(2).max(4),
    }),
  ],
  preview: {
    select: { tabs: 'tabs' },
    prepare: ({ tabs }) => ({
      title: 'Insights Tabs',
      subtitle: `${Array.isArray(tabs) ? tabs.length : 0} tabs`,
    }),
  },
});

export const csEpisodeListBlock = defineType({
  name: 'csEpisodeListBlock',
  title: 'Episode / Talk List',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Articles (on-site posts)', value: 'article' },
          { title: 'Publications (podcast episodes)', value: 'publication' },
          { title: 'Presentations (speaking)', value: 'presentation' },
        ],
        layout: 'radio',
      },
      description: 'Filters which Publication records appear. Podcast episodes are "publication"; speaking engagements are "presentation". Leave empty for all kinds.',
    }),
    defineField({ name: 'limit', title: 'Limit', type: 'number', initialValue: 12 }),
    defineField({ name: 'showListenLinks', title: 'Show Listen Links', type: 'boolean', initialValue: true }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
  ],
  preview: {
    select: { title: 'heading', kind: 'kind', limit: 'limit' },
    prepare: ({ title, kind, limit }) => ({
      title: title ?? 'Episode / Talk List',
      subtitle: [kind, limit ? `limit ${limit}` : null].filter(Boolean).join(' · '),
    }),
  },
});

export const csAssessmentBlock = defineType({
  name: 'csAssessmentBlock',
  title: 'Assessment (quiz embed)',
  type: 'object',
  fields: [
    defineField({
      name: 'introHeading',
      title: 'Intro Heading',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'introBody', title: 'Intro Body', type: 'text', rows: 3 }),
    defineField({ name: 'startLabel', title: 'Start Label', type: 'string', initialValue: 'Start Assessment' }),
    defineField({
      name: 'quiz',
      title: 'Assessment',
      type: 'reference',
      to: [{ type: 'csAssessment' }],
      validation: (r) => r.required(),
      description: 'The question set and scoring. Edit questions in the Assessment document, not here, so the same quiz can be embedded on more than one page.',
    }),
    defineField({
      name: 'captureTiming',
      title: 'Lead Capture Timing',
      type: 'string',
      options: {
        list: [
          { title: 'Before result (gated)', value: 'before-result' },
          { title: 'After result', value: 'after-result' },
          { title: 'Never', value: 'never' },
        ],
        layout: 'radio',
      },
      initialValue: 'after-result',
      description: 'When the name/email form appears. "After result" shows the stage first and converts better; "before result" gates it.',
    }),
    defineField({ name: 'resultCtaLabel', title: 'Result CTA Label', type: 'string' }),
    defineField({ name: 'resultCtaHref', title: 'Result CTA Href', type: 'string', initialValue: '/contact' }),
  ],
  preview: {
    select: { title: 'introHeading', quiz: 'quiz.title' },
    prepare: ({ title, quiz }) => ({ title: title ?? 'Assessment', subtitle: quiz }),
  },
});

export const csDisclosureBlock = defineType({
  name: 'csDisclosureBlock',
  title: 'Disclosure Slab',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'lastUpdated',
      title: 'Last Updated',
      type: 'datetime',
      description: 'Shown as "Last updated <date>". Compliance reviewers look for this.',
    }),
    defineField({ name: 'content', title: 'Content', type: 'csBody', validation: (r) => r.required() }),
    defineField({
      name: 'note',
      title: 'Note',
      type: 'text',
      rows: 3,
      description: 'Boxed footnote under the body, e.g. the ADV / not-investment-advice line.',
    }),
  ],
  preview: {
    select: { title: 'heading', subtitle: 'lastUpdated' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Disclosure Slab', subtitle }),
  },
});


/* ---------------------------------------------------------------------------
 * The CueDuo set (site #3). Line-generic like every other block: these exist
 * because an app marketing site needs a device, a store badge, a price and a
 * script surface, and none of the professional-services blocks carry those.
 * Any custom site may use them.
 * ------------------------------------------------------------------------- */

export const csAppHeroBlock = defineType({
  name: 'csAppHeroBlock',
  title: 'App Hero',
  type: 'object',
  fields: [
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'string',
      description: 'Small line above the headline. Two or three words, e.g. "Teleprompter and recorder".',
    }),
    defineField({
      name: 'heading',
      title: 'Heading',
      type: 'text',
      rows: 2,
      description:
        'The promise. Sentence case, no exclamation marks. A line break here is kept on the page, so "Look up." and "Say it once." can sit on their own lines.',
      validation: (r) => r.required().max(60),
    }),
    defineField({
      name: 'subheading',
      title: 'Subheading',
      type: 'text',
      rows: 3,
      description: 'One paragraph. Keep lines to 45-70 characters.',
    }),
    defineField({
      name: 'device',
      title: 'Device Render',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() })],
      description:
        'A photographed or 3D render of the device, both screens legible, on a transparent background. When set it replaces the built-in fold preview below.',
    }),
    defineField({
      name: 'deviceCaption',
      title: 'Device Caption',
      type: 'string',
      description: 'Optional. Names the screen shown.',
    }),
    defineField({
      name: 'foldPreview',
      title: 'Fold Preview',
      type: 'csFoldPreview',
      description:
        'The built-in two-pane device illustration, drawn from these strings. Used only when no Device Render is uploaded. Copy must describe the real app.',
    }),
    defineField({
      name: 'storeState',
      title: 'Store State',
      type: 'string',
      options: { list: [{ title: 'Coming soon', value: 'soon' }, { title: 'Live', value: 'live' }] },
      initialValue: 'soon',
      description: '"Coming soon" shows an ink pill. "Live" shows the App Store badge and needs a Store Href.',
    }),
    defineField({
      name: 'storeLabel',
      title: 'Store Label',
      type: 'string',
      initialValue: 'Coming to the App Store',
      description: 'The pill text while the Store State is "Coming soon".',
    }),
    defineField({
      name: 'storeHref',
      title: 'Store Href',
      type: 'url',
      description: 'App Store URL. Required once Store State is "Live".',
      validation: (r) =>
        r.custom((value, context) => {
          const state = (context.parent as { storeState?: unknown } | undefined)?.storeState;
          if (state === 'live' && !value) return 'A live store state needs an App Store URL.';
          return true;
        }),
    }),
    defineField({
      name: 'qualifier',
      title: 'Qualifier',
      type: 'string',
      description: 'The small print under the buttons. Device and system requirements, kept factual.',
    }),
    defineField({ name: 'secondaryLabel', title: 'Secondary Link Label', type: 'string' }),
    defineField({ name: 'secondaryHref', title: 'Secondary Link Href', type: 'string' }),
  ],
  preview: {
    select: { title: 'heading', subtitle: 'eyebrow', media: 'device' },
    prepare: ({ title, subtitle, media }) => ({ title: `App Hero — ${title ?? ''}`, subtitle, media }),
  },
});

export const csDeviceShowcaseBlock = defineType({
  name: 'csDeviceShowcaseBlock',
  title: 'Device Showcase',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'body', title: 'Body', type: 'text', rows: 4 }),
    defineField({
      name: 'screen',
      title: 'Screen',
      type: 'image',
      options: { hotspot: true },
      fields: [defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() })],
      description:
        'A real frame exported from the app, at 1:1 pixels with no shadow or device frame baked in — the frame is drawn in CSS.',
    }),
    defineField({
      name: 'side',
      title: 'Screen Side',
      type: 'string',
      options: { list: [{ title: 'Right', value: 'right' }, { title: 'Left', value: 'left' }] },
      initialValue: 'right',
      description: 'Which side the device sits on at desktop width. Alternate it down a page.',
    }),
    defineField({
      name: 'band',
      title: 'Band',
      type: 'string',
      options: { list: [{ title: 'Porcelain (light)', value: 'porcelain' }, { title: 'Graphite (dark)', value: 'graphite' }] },
      initialValue: 'porcelain',
    }),
    defineField({ name: 'caption', title: 'Caption', type: 'string' }),
    defineField({ name: 'ctaLabel', title: 'Link Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'Link Href', type: 'string' }),
  ],
  preview: {
    select: { title: 'heading', subtitle: 'eyebrow', media: 'screen' },
    prepare: ({ title, subtitle, media }) => ({ title: `Showcase — ${title ?? ''}`, subtitle, media }),
  },
});

export const csPrompterBandBlock = defineType({
  name: 'csPrompterBandBlock',
  title: 'Prompter Band',
  type: 'object',
  description: 'The near-black script surface. Static by design: no animation, no JavaScript.',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', initialValue: 'This is what you read from' }),
    defineField({
      name: 'pastLine',
      title: 'Past Line',
      type: 'text',
      rows: 2,
      description: 'The line already spoken. Renders dimmed to 35%.',
    }),
    defineField({
      name: 'currentLine',
      title: 'Current Line',
      type: 'text',
      rows: 3,
      description: 'The line being read. Full white. Keep it to one sentence.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'nextLine',
      title: 'Next Line',
      type: 'text',
      rows: 2,
      description: 'The line coming up. Renders dimmed to 35%.',
    }),
    defineField({
      name: 'notes',
      title: 'Notes',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Up to three short explanations under the script.',
      validation: (r) => r.max(3),
    }),
  ],
  preview: {
    select: { title: 'currentLine' },
    prepare: ({ title }) => ({ title: 'Prompter Band', subtitle: title }),
  },
});

export const csPlansBlock = defineType({
  name: 'csPlansBlock',
  title: 'Plans',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'intro', title: 'Intro', type: 'text', rows: 3 }),
    defineField({
      name: 'plans',
      title: 'Plans',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csPlan',
          title: 'Plan',
          fields: [
            defineField({ name: 'name', title: 'Name', type: 'string', validation: (r) => r.required() }),
            defineField({
              name: 'price',
              title: 'Price',
              type: 'string',
              description: 'Exactly as the App Store shows it, e.g. "$59". A string, not a number, so currency and formatting stay correct.',
              validation: (r) => r.required(),
            }),
            defineField({ name: 'period', title: 'Period', type: 'string', description: 'e.g. "per year". Leave empty for a one-off or free plan.' }),
            defineField({
              name: 'recommended',
              title: 'Recommended',
              type: 'boolean',
              initialValue: false,
              description: 'At most one plan. Adds the flag and lifts the card.',
            }),
            defineField({ name: 'features', title: 'Features', type: 'array', of: [{ type: 'string' }] }),
            defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
            defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
            defineField({ name: 'note', title: 'Note', type: 'text', rows: 2, description: 'Replaces the CTA when a plan has nothing to buy.' }),
          ],
          preview: { select: { title: 'name', subtitle: 'price' } },
        },
      ],
      validation: (r) =>
        r.max(4).custom((plans) => {
          if (!Array.isArray(plans)) return true;
          const flagged = plans.filter((p) => (p as { recommended?: boolean }).recommended).length;
          return flagged > 1 ? 'Only one plan can be recommended.' : true;
        }),
    }),
    defineField({
      name: 'footnote',
      title: 'Footnote',
      type: 'text',
      rows: 2,
      description: 'Billing, trial length, restore purchase, and any pricing caveat.',
    }),
  ],
  preview: {
    select: { title: 'heading', plans: 'plans' },
    prepare: ({ title, plans }) => ({
      title: title ?? 'Plans',
      subtitle: `${Array.isArray(plans) ? plans.length : 0} plans`,
    }),
  },
});

export const csRequirementsBlock = defineType({
  name: 'csRequirementsBlock',
  title: 'Requirements',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string', description: 'Optional. Without it the rail sits directly under its hairline rule.' }),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csRequirement',
          title: 'Requirement',
          fields: [
            defineField({ name: 'label', title: 'Label', type: 'string', description: 'Device, System, Storage, Languages.', validation: (r) => r.required() }),
            defineField({ name: 'value', title: 'Value', type: 'string', description: 'Short and factual. "TBC" is an acceptable value.', validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'label', subtitle: 'value' } },
        },
      ],
      validation: (r) => r.min(2),
    }),
  ],
  preview: {
    select: { title: 'heading', items: 'items' },
    prepare: ({ title, items }) => ({
      title: title ?? 'Requirements',
      subtitle: `${Array.isArray(items) ? items.length : 0} facts`,
    }),
  },
});

export const csAppCtaBlock = defineType({
  name: 'csAppCtaBlock',
  title: 'App CTA Band',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'body', title: 'Body', type: 'text', rows: 2 }),
    defineField({
      name: 'showMark',
      title: 'Show Mark',
      type: 'boolean',
      initialValue: true,
      description: 'Sets the site logo above the heading.',
    }),
    defineField({
      name: 'storeState',
      title: 'Store State',
      type: 'string',
      options: { list: [{ title: 'Coming soon', value: 'soon' }, { title: 'Live', value: 'live' }] },
      initialValue: 'soon',
    }),
    defineField({ name: 'storeLabel', title: 'Store Label', type: 'string', initialValue: 'Coming to the App Store' }),
    defineField({
      name: 'storeHref',
      title: 'Store Href',
      type: 'url',
      validation: (r) =>
        r.custom((value, context) => {
          const state = (context.parent as { storeState?: unknown } | undefined)?.storeState;
          if (state === 'live' && !value) return 'A live store state needs an App Store URL.';
          return true;
        }),
    }),
    defineField({ name: 'qualifier', title: 'Qualifier', type: 'string' }),
    defineField({
      name: 'band',
      title: 'Band',
      type: 'string',
      options: { list: [{ title: 'Graphite (dark)', value: 'graphite' }, { title: 'Porcelain (light)', value: 'porcelain' }] },
      initialValue: 'graphite',
    }),
  ],
  preview: {
    select: { title: 'heading', subtitle: 'storeState' },
    prepare: ({ title, subtitle }) => ({ title: `App CTA — ${title ?? ''}`, subtitle }),
  },
});

export const csContrastBlock = defineType({
  name: 'csContrastBlock',
  title: 'Before / After Contrast',
  type: 'object',
  description:
    'Two labelled columns of paired lines. Unlike csCompareBlock this carries no attributed quotes, so it never implies a person said anything.',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'leftLabel', title: 'Left Label', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'rightLabel', title: 'Right Label', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'rows',
      title: 'Rows',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csContrastRow',
          title: 'Row',
          fields: [
            defineField({ name: 'left', title: 'Left', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'right', title: 'Right', type: 'string', validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'right', subtitle: 'left' } },
        },
      ],
      validation: (r) => r.min(2),
    }),
    defineField({
      name: 'footnote',
      title: 'Footnote',
      type: 'text',
      rows: 2,
      description: 'Use this to say what the comparison does not claim. Any measurable claim needs a source.',
    }),
  ],
  preview: {
    select: { title: 'heading', rows: 'rows' },
    prepare: ({ title, rows }) => ({
      title: title ?? 'Contrast',
      subtitle: `${Array.isArray(rows) ? rows.length : 0} rows`,
    }),
  },
});

export const customSitesSectionTypes = [
  csHeroBlock,
  csIntroBlock,
  csPracticeGridBlock,
  csAttorneyBlock,
  csTestimonialsBlock,
  csBadgeRowBlock,
  csPublicationsBlock,
  csCalloutBlock,
  csRichTextBlock,
  csContactCtaBlock,
  csCtaBannerBlock,
  csFaqBlock,
  csStatRailBlock,
  csValuePropsBlock,
  csJourneyBlock,
  csCompareBlock,
  csTeamGridBlock,
  csFocusAreaListBlock,
  csCaseStudyGridBlock,
  csNumbersIqBlock,
  csLeadMagnetBlock,
  csTabbedInsightsBlock,
  csEpisodeListBlock,
  csAssessmentBlock,
  csDisclosureBlock,
  csAppHeroBlock,
  csDeviceShowcaseBlock,
  csPrompterBandBlock,
  csPlansBlock,
  csRequirementsBlock,
  csAppCtaBlock,
  csContrastBlock,
];
