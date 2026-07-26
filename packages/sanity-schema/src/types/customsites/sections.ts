import { defineType, defineField } from 'sanity';

/**
 * The 12 Custom Sites page-builder blocks. They are members of
 * `csPage.pageBuilder[]` and render in array order. Each is `cs`-prefixed.
 */

export const csHeroBlock = defineType({
  name: 'csHeroBlock',
  title: 'Hero',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'subheading', title: 'Subheading', type: 'text', rows: 2 }),
    defineField({ name: 'ctaLabel', title: 'CTA Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Href', type: 'string' }),
    defineField({ name: 'backgroundImage', title: 'Background Image', type: 'image', options: { hotspot: true } }),
  ],
  preview: {
    select: { title: 'heading', media: 'backgroundImage' },
    prepare: ({ title, media }) => ({ title: `Hero — ${title ?? ''}`, media }),
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
      name: 'badges',
      title: 'Badges',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csBadge' }] }],
    }),
  ],
  preview: { prepare: () => ({ title: 'Badge Row' }) },
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
];
