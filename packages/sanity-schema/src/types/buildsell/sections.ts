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
    defineField({
      name: 'imageIsLead',
      title: 'Hero Image Is Lead (Trust layout)',
      type: 'boolean',
      initialValue: false,
      description:
        'Trust layout only. When enabled, the Hero Image renders uncropped above Hero Images B & C, which center below it. When disabled, all three images render as an equal 3-across strip.',
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
  preview: {
    select: { title: 'headline', media: 'image' },
    prepare: ({ title, media }) => ({ title: `Hero — ${title ?? ''}`, media }),
  },
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
  preview: {
    select: { media: 'image' },
    prepare: ({ media }) => ({ title: 'About', media }),
  },
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
    defineField({
      name: 'cta',
      title: 'Call-to-action Button',
      type: 'bsCtaButton',
      description: 'Optional button shown centered below the reviews (e.g. "Read More Reviews" → Google, or "Get a Free Quote" → #contact). Leave empty to hide.',
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
    defineField({ name: 'showMap', title: 'Show Service-Area Map', type: 'boolean', initialValue: false, description: 'Embed a Google map of the service area under the contact details.' }),
    defineField({
      name: 'mapQuery',
      title: 'Map Location',
      type: 'string',
      description: 'What the map centers on. Leave empty to use the Service Area, then the street address, then City + State. Set this when the Service Area is prose ("all of the East Valley") that a map cannot resolve — e.g. "San Tan Valley, AZ".',
      hidden: ({ parent }) => !parent?.showMap,
    }),
    defineField({
      name: 'mapZoom',
      title: 'Map Zoom',
      type: 'number',
      description: 'Higher is closer. 10-12 shows a metro service area, 15+ shows a single address.',
      initialValue: 11,
      validation: (r) => r.min(1).max(20),
      hidden: ({ parent }) => !parent?.showMap,
    }),
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
      name: 'defaultOpen',
      title: 'Open By Default',
      type: 'string',
      options: {
        list: [
          { title: 'First item only', value: 'first' },
          { title: 'All expanded', value: 'all' },
          { title: 'All collapsed', value: 'none' },
        ],
        layout: 'radio',
      },
      initialValue: 'first',
      description:
        'Which answers are already showing when the page loads. Every answer is in the page either way — collapsing only hides it visually, so this does not affect the FAQ rich result.',
    }),
    defineField({
      name: 'items',
      title: 'FAQ Items',
      type: 'array',
      of: [{ type: 'bsFaqItem' }],
    }),
  ],
  preview: { prepare: () => ({ title: 'FAQ' }) },
});

/**
 * Pricing section. Two render layouts off the same data:
 *  - 'cards': tier cards with a big price + feature bullets, one tier liftable
 *    as "most popular". Best for plans / packages.
 *  - 'table': compact price list (name + price per row). Best for service menus
 *    and volume-based pricing where you just need name → price fast.
 * Low-effort to populate: a row needs only a name + price; everything else is
 * optional polish.
 */
export const bsPricingSection = defineType({
  name: 'bsPricingSection',
  title: 'Pricing',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', initialValue: 'Pricing' }),
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Cards (plans with features)', value: 'cards' },
          { title: 'Table (simple price list)', value: 'table' },
        ],
        layout: 'radio',
      },
      initialValue: 'cards',
      description: 'Cards = tier cards with feature bullets. Table = compact name → price list.',
    }),
    defineField({
      name: 'tiers',
      title: 'Tiers / Rows',
      type: 'array',
      of: [{ type: 'bsPricingTier' }],
      validation: (r) => r.min(1),
    }),
    defineField({ name: 'footnote', title: 'Footnote', type: 'text', rows: 2, description: 'Fine print under the prices, e.g. "Prices vary by load size and material. Final quote confirmed on site."' }),
  ],
  preview: {
    select: { layout: 'layout', tiers: 'tiers' },
    prepare: ({ layout, tiers }) => ({
      title: 'Pricing',
      subtitle: [layout === 'table' ? 'Table' : 'Cards', tiers?.length ? `${tiers.length} tiers` : null].filter(Boolean).join(' · '),
    }),
  },
});

/**
 * Before / After gallery. Two render layouts off the same `pairs` data:
 *  - 'slider': the two photos stack in one frame with a draggable divider, so
 *    the visitor wipes between them. Strongest proof, and the reveal itself is
 *    the interaction.
 *  - 'grid': the pair sits side by side under Before / After labels. Better
 *    when the two shots are framed differently, or for print/PDF-style reading.
 * Both layouts share the same markup contract, so switching is a one-field
 * change with no re-upload.
 */
export const bsBeforeAfterSection = defineType({
  name: 'bsBeforeAfterSection',
  title: 'Before / After Gallery',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'string', description: 'Uppercase kicker above the heading.' }),
    defineField({ name: 'heading', title: 'Heading', type: 'string', initialValue: 'Before & After' }),
    defineField({ name: 'subhead', title: 'Subhead', type: 'text', rows: 2 }),
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: {
        list: [
          { title: 'Slider (drag to reveal)', value: 'slider' },
          { title: 'Grid (side by side)', value: 'grid' },
        ],
        layout: 'radio',
      },
      initialValue: 'slider',
      description: 'Slider = one frame with a draggable divider. Grid = the two photos side by side.',
    }),
    defineField({
      name: 'pairs',
      title: 'Projects',
      type: 'array',
      of: [{ type: 'bsBeforeAfterPair' }],
      validation: (r) => r.min(1),
      description: 'One entry per job. Two or three strong pairs beat a long wall of thumbnails.',
    }),
    defineField({
      name: 'beforeLabel',
      title: 'Before Label',
      type: 'string',
      initialValue: 'Before',
      description: 'Overrides the "Before" chip on every pair.',
    }),
    defineField({
      name: 'afterLabel',
      title: 'After Label',
      type: 'string',
      initialValue: 'After',
      description: 'Overrides the "After" chip on every pair.',
    }),
    defineField({
      name: 'aspect',
      title: 'Frame Shape',
      type: 'string',
      options: {
        list: [
          { title: 'Landscape (4:3)', value: '4/3' },
          { title: 'Wide (16:9)', value: '16/9' },
          { title: 'Square (1:1)', value: '1/1' },
          { title: 'Portrait (3:4)', value: '3/4' },
        ],
        layout: 'radio',
      },
      initialValue: '4/3',
      description: 'Every frame is locked to this shape so the row stays aligned and the page does not jump while images load.',
    }),
    defineField({
      name: 'cta',
      title: 'Call-to-action Button',
      type: 'bsCtaButton',
      description: 'Optional button centered below the gallery (e.g. "Get a Free Quote" → #contact). Leave empty to hide.',
    }),
  ],
  preview: {
    select: { layout: 'layout', pairs: 'pairs', media: 'pairs.0.after' },
    prepare: ({ layout, pairs, media }) => ({
      title: 'Before / After Gallery',
      subtitle: [layout === 'grid' ? 'Grid' : 'Slider', pairs?.length ? `${pairs.length} projects` : null]
        .filter(Boolean)
        .join(' · '),
      media,
    }),
  },
});

/**
 * Freeform HTML block. Renders raw markup as-is on the page, in section order.
 * Operator-authored only (not exposed in the customer self-edit portal), so the
 * content is trusted; the site renderer injects it via dangerouslySetInnerHTML.
 */
export const bsHtmlSection = defineType({
  name: 'bsHtmlSection',
  title: 'Custom HTML',
  type: 'object',
  fields: [
    defineField({
      name: 'label',
      title: 'Label (internal)',
      type: 'string',
      description: 'Optional name shown in the Studio sections list to identify this block. Not rendered on the site.',
    }),
    defineField({
      name: 'html',
      title: 'HTML',
      type: 'text',
      rows: 14,
      description: 'Raw HTML rendered exactly as written. Authored by operators only — invalid or unsafe markup will render as-is, so paste with care.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'fullWidth',
      title: 'Full width (edge-to-edge)',
      type: 'boolean',
      initialValue: false,
      description: 'Off: wrapped in the site’s centered container with standard section padding. On: spans the full viewport width with no wrapper.',
    }),
  ],
  preview: {
    select: { label: 'label' },
    prepare: ({ label }) => ({ title: label ? `Custom HTML — ${label}` : 'Custom HTML' }),
  },
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
  bsHtmlSection,
  bsPricingSection,
  bsBeforeAfterSection,
];
