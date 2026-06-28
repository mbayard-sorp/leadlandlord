import { defineType, defineField } from 'sanity';

/**
 * The 7 Build & Sell section blocks. They are members of `buildsellSite.sections[]`
 * and render in array order. Each is `bs`-prefixed.
 */

export const bsHeroSection = defineType({
  name: 'bsHeroSection',
  title: 'Hero',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string' }),
    defineField({ name: 'headline', title: 'Headline', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'highlight', title: 'Highlight', type: 'string', description: 'Emphasised fragment of the headline.' }),
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({
      name: 'image',
      title: 'Hero Image',
      type: 'image',
      options: { hotspot: true },
      description: 'AI-generated hero. Uploaded by the spec-site-builder agent.',
    }),
    defineField({
      name: 'imageB',
      title: 'Hero Image B (Trust strip tile 2)',
      type: 'image',
      options: { hotspot: true },
      description: 'Second tile of the Trust-layout hero strip. Auto-filled from the hero prompt; ignored by other layouts.',
    }),
    defineField({
      name: 'imageC',
      title: 'Hero Image C (Trust strip tile 3)',
      type: 'image',
      options: { hotspot: true },
      description: 'Third tile of the Trust-layout hero strip. Auto-filled from the hero prompt; ignored by other layouts.',
    }),
    defineField({ name: 'showRating', title: 'Show Rating', type: 'boolean', initialValue: true }),
    defineField({ name: 'badges', title: 'Trust Badges', type: 'array', of: [{ type: 'bsTrustBadge' }] }),
    defineField({ name: 'primaryCta', title: 'Primary CTA', type: 'bsCtaButton' }),
    defineField({ name: 'secondaryCta', title: 'Secondary CTA', type: 'bsCtaButton' }),
    defineField({
      name: 'imageAlt',
      title: 'Image Alt Text',
      type: 'string',
      description: 'Describes the hero image for Google Images + screen readers.',
    }),
  ],
  preview: { select: { title: 'headline' }, prepare: ({ title }) => ({ title: `Hero — ${title ?? ''}` }) },
});

export const bsServicesSection = defineType({
  name: 'bsServicesSection',
  title: 'Services',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({ name: 'services', title: 'Services', type: 'array', of: [{ type: 'bsServiceCard' }] }),
  ],
  preview: { prepare: () => ({ title: 'Services' }) },
});

export const bsAboutSection = defineType({
  name: 'bsAboutSection',
  title: 'About',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'body', title: 'Body', type: 'text', rows: 5 }),
    defineField({ name: 'image', title: 'Image', type: 'image', options: { hotspot: true } }),
    defineField({ name: 'stats', title: 'Stats', type: 'array', of: [{ type: 'bsStatItem' }] }),
    defineField({ name: 'cta', title: 'CTA', type: 'bsCtaButton', description: 'Optional call-to-action at the end of the about copy.' }),
    defineField({
      name: 'imageAlt',
      title: 'Image Alt Text',
      type: 'string',
      description: 'Describes the about image for Google Images + screen readers.',
    }),
  ],
  preview: { prepare: () => ({ title: 'About' }) },
});

export const bsProcessSection = defineType({
  name: 'bsProcessSection',
  title: 'How It Works',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'steps', title: 'Steps', type: 'array', of: [{ type: 'bsProcessStep' }] }),
  ],
  preview: { prepare: () => ({ title: 'How It Works' }) },
});

export const bsReviewsSection = defineType({
  name: 'bsReviewsSection',
  title: 'Reviews',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', validation: (r) => r.required() }),
    // `showRating` is the spec's `showSummary` (rating + count chip).
    defineField({ name: 'showRating', title: 'Show Aggregate Rating', type: 'boolean', initialValue: true }),
    defineField({
      name: 'reviews',
      title: 'Reviews',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'bsReview' }] }],
      description: 'References to bsReview docs (Claude-written representative testimonials).',
    }),
  ],
  preview: { prepare: () => ({ title: 'Reviews' }) },
});

export const bsContactSection = defineType({
  name: 'bsContactSection',
  title: 'Contact',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    // `subhead` carries the spec's `intro` reassurance line.
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({ name: 'address', title: 'Contact Panel', type: 'bsAddress' }),
    defineField({ name: 'formLabels', title: 'Form Labels', type: 'bsFormLabels', description: 'Override the lead-form field/button labels. Defaults applied when empty.' }),
    defineField({
      name: 'formEndpoint',
      title: 'Form Endpoint',
      type: 'string',
      initialValue: '/api/bs/lead',
      description: 'Where the lead form POSTs. Defaults to the operator lead endpoint.',
    }),
    defineField({ name: 'showDetails', title: 'Show Contact Details Panel', type: 'boolean', initialValue: true, description: 'Render the phone/address/hours/service-area panel.' }),
    defineField({ name: 'showMap', title: 'Show Service-Area Map', type: 'boolean', initialValue: false, description: 'Render a styled service-area map block (Bold/Trust layouts).' }),
  ],
  preview: { prepare: () => ({ title: 'Contact' }) },
});

export const bsFooterSection = defineType({
  name: 'bsFooterSection',
  title: 'Footer',
  type: 'object',
  fields: [
    defineField({ name: 'tagline', title: 'Tagline', type: 'string' }),
    defineField({ name: 'columns', title: 'Columns', type: 'array', of: [{ type: 'bsFooterColumn' }] }),
    defineField({ name: 'social', title: 'Social Links', type: 'array', of: [{ type: 'bsSocialLink' }] }),
    defineField({ name: 'legal', title: 'Legal Row', type: 'string' }),
    defineField({ name: 'legalLinks', title: 'Legal Links', type: 'array', of: [{ type: 'bsNavLink' }], description: 'Footer legal nav: Privacy Policy, Terms of Service, etc.' }),
  ],
  preview: { prepare: () => ({ title: 'Footer' }) },
});

/**
 * Curated social-proof / UGC gallery. Operator-picked post screenshots +
 * links. Renders only when it has items (an empty placeholder is harmless).
 * Populated from the migration review queue or by hand in Studio.
 */
export const bsUgcSection = defineType({
  name: 'bsUgcSection',
  title: 'Social Gallery',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({ name: 'items', title: 'Posts', type: 'array', of: [{ type: 'bsUgcItem' }] }),
  ],
  preview: { prepare: () => ({ title: 'Social Gallery' }) },
});

/**
 * Inline object for a single FAQ item inside bsFaqSection.
 */
export const bsFaqItem = defineType({
  name: 'bsFaqItem',
  title: 'FAQ Item',
  type: 'object',
  fields: [
    defineField({ name: 'question', title: 'Question', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'answer', title: 'Answer', type: 'text', rows: 3, validation: (r) => r.required() }),
  ],
  preview: {
    select: { title: 'question' },
    prepare: ({ title }) => ({ title: title ?? '(question)' }),
  },
});

/**
 * FAQ accordion section. Used for FAQPage JSON-LD and optional visible render.
 */
export const bsFaqSection = defineType({
  name: 'bsFaqSection',
  title: 'FAQ',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'items',
      title: 'FAQ Items',
      type: 'array',
      of: [{ type: 'bsFaqItem' }],
    }),
  ],
  preview: { prepare: () => ({ title: 'FAQ' }) },
});

export const buildsellSectionTypes = [
  bsHeroSection,
  bsServicesSection,
  bsAboutSection,
  bsProcessSection,
  bsReviewsSection,
  bsContactSection,
  bsFaqSection,
  bsFooterSection,
  bsUgcSection,
];
