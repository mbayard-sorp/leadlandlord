import { defineType, defineField } from 'sanity';

/**
 * Build & Sell reusable object types. Every type is `bs`-prefixed so it can
 * never collide with the R&R schema in the shared dataset.
 */

export const bsCtaButton = defineType({
  name: 'bsCtaButton',
  title: 'CTA Button',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({
      name: 'href',
      title: 'Href',
      type: 'string',
      description: 'Anchor (e.g. "#contact"), tel: link, or URL.',
    }),
    defineField({
      name: 'style',
      title: 'Style',
      type: 'string',
      options: {
        list: [
          { title: 'Primary', value: 'primary' },
          { title: 'Secondary', value: 'secondary' },
          { title: 'Ghost', value: 'ghost' },
        ],
      },
      initialValue: 'primary',
    }),
  ],
  preview: { select: { title: 'label', subtitle: 'href' } },
});

export const bsServiceCard = defineType({
  name: 'bsServiceCard',
  title: 'Service Card',
  type: 'object',
  fields: [
    defineField({
      name: 'icon',
      title: 'Icon',
      type: 'string',
      description: 'lucide icon name (e.g. "wrench", "droplet", "shield-check").',
    }),
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2 }),
    defineField({ name: 'link', title: 'Link', type: 'string' }),
  ],
  preview: { select: { title: 'title', subtitle: 'icon' } },
});

/**
 * One pricing tier / line item inside a bsPricingSection.
 *
 * `price` is a free string ("$250", "From $99", "Call for quote") so it works
 * for fixed prices, ranges, and "contact us" rows without parsing. `unit` is the
 * small qualifier shown next to it ("per load", "/mo"). `features` drives the
 * card-layout bullet list; the table layout ignores it. `featured` lifts the
 * tier (the "most popular" column / highlighted row) and `badge` is its ribbon.
 */
export const bsPricingTier = defineType({
  name: 'bsPricingTier',
  title: 'Pricing Tier',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string', description: 'e.g. "1/4 Truck", "Standard", "Single Item".', validation: (r) => r.required() }),
    defineField({ name: 'price', title: 'Price', type: 'string', description: 'Shown big. Free text: "$250", "From $99", "Call for quote".', validation: (r) => r.required() }),
    defineField({ name: 'unit', title: 'Unit / Period', type: 'string', description: 'Small qualifier next to the price, e.g. "per load", "/month", "flat rate".' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2, description: 'One short line explaining what this tier covers.' }),
    defineField({ name: 'features', title: 'Features', type: 'array', of: [{ type: 'string' }], description: 'Bullet points shown in the Cards layout. Optional; ignored by the Table layout.' }),
    defineField({ name: 'featured', title: 'Highlight this tier', type: 'boolean', initialValue: false, description: 'Lifts this tier as the "most popular" option.' }),
    defineField({ name: 'badge', title: 'Badge', type: 'string', description: 'Ribbon label on a highlighted tier, e.g. "Most Popular", "Best Value".' }),
    defineField({ name: 'cta', title: 'Button', type: 'bsCtaButton', description: 'Per-tier action button. Defaults to a "Get a Quote" → #contact button in the Cards layout when empty.' }),
  ],
  preview: {
    select: { title: 'name', price: 'price', featured: 'featured' },
    prepare: ({ title, price, featured }) => ({
      title: [title, featured ? '★' : null].filter(Boolean).join(' '),
      subtitle: price ?? '',
    }),
  },
});

export const bsProcessStep = defineType({
  name: 'bsProcessStep',
  title: 'Process Step',
  type: 'object',
  fields: [
    defineField({ name: 'icon', title: 'Icon', type: 'string', description: 'lucide icon name.' }),
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2 }),
  ],
  preview: { select: { title: 'title', subtitle: 'description' } },
});

export const bsTrustBadge = defineType({
  name: 'bsTrustBadge',
  title: 'Trust Badge',
  type: 'object',
  fields: [
    defineField({ name: 'icon', title: 'Icon', type: 'string', description: 'lucide icon name.' }),
    defineField({ name: 'label', title: 'Label', type: 'string' }),
  ],
  preview: { select: { title: 'label', subtitle: 'icon' } },
});

export const bsStatItem = defineType({
  name: 'bsStatItem',
  title: 'Stat Item',
  type: 'object',
  fields: [
    defineField({ name: 'value', title: 'Value', type: 'string', description: 'e.g. "15+", "2,400".' }),
    defineField({ name: 'label', title: 'Label', type: 'string', description: 'e.g. "Years in business".' }),
  ],
  preview: { select: { title: 'value', subtitle: 'label' } },
});

export const bsNavLink = defineType({
  name: 'bsNavLink',
  title: 'Nav Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'string' }),
    defineField({ name: 'href', title: 'Href', type: 'string', description: 'Anchor id (e.g. "#services").' }),
  ],
  preview: { select: { title: 'label', subtitle: 'href' } },
});

export const bsFooterColumn = defineType({
  name: 'bsFooterColumn',
  title: 'Footer Column',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({
      name: 'links',
      title: 'Links',
      type: 'array',
      of: [{ type: 'bsNavLink' }],
    }),
  ],
  preview: { select: { title: 'heading' } },
});

export const bsSocialLink = defineType({
  name: 'bsSocialLink',
  title: 'Social Link',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      description: 'lucide brand icon name (e.g. "facebook", "instagram").',
    }),
    defineField({ name: 'href', title: 'Href', type: 'url' }),
  ],
  preview: { select: { title: 'platform', subtitle: 'href' } },
});

export const bsAddress = defineType({
  name: 'bsAddress',
  title: 'Address',
  type: 'object',
  fields: [
    defineField({ name: 'street', title: 'Street', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State', type: 'string' }),
    defineField({ name: 'zip', title: 'ZIP', type: 'string' }),
    defineField({ name: 'hours', title: 'Hours', type: 'string', description: 'e.g. "Mon–Sat 7am–6pm".' }),
    defineField({ name: 'serviceArea', title: 'Service Area', type: 'string' }),
  ],
  preview: { select: { title: 'city', subtitle: 'state' } },
});

export const bsSeo = defineType({
  name: 'bsSeo',
  title: 'SEO',
  type: 'object',
  fields: [
    defineField({ name: 'metaTitle', title: 'Meta Title', type: 'string' }),
    defineField({ name: 'metaDescription', title: 'Meta Description', type: 'text', rows: 2 }),
    defineField({ name: 'ogImage', title: 'OG Image', type: 'image' }),
  ],
});

/**
 * Editable labels for the contact lead form. Authored by the spec-site-builder
 * and rendered by ContactBlock (falls back to sensible defaults when absent).
 * Declared so the writer's `_type: 'bsFormLabels'` resolves in Studio.
 */
export const bsFormLabels = defineType({
  name: 'bsFormLabels',
  title: 'Form Labels',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name Field', type: 'string' }),
    defineField({ name: 'phone', title: 'Phone Field', type: 'string' }),
    defineField({ name: 'email', title: 'Email Field', type: 'string' }),
    defineField({ name: 'message', title: 'Message Field', type: 'string' }),
    defineField({ name: 'submit', title: 'Submit Button', type: 'string' }),
  ],
  preview: { select: { title: 'submit' } },
});

/**
 * One curated social / UGC post shown in the bsUgcSection gallery.
 *
 * `thumbnail` is the displayed image (a post screenshot captured during the
 * migration crawl, or an operator upload). `postUrl` links out to the live
 * post. `embedHtml` is reserved for a future post-sale live-embed phase and
 * is unused by the curated-gallery renderer.
 */
export const bsUgcItem = defineType({
  name: 'bsUgcItem',
  title: 'UGC Item',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      description: 'lucide brand icon name (e.g. "instagram", "facebook", "music-2" for TikTok).',
    }),
    defineField({ name: 'postUrl', title: 'Post URL', type: 'url', validation: (r) => r.uri({ scheme: ['http', 'https'] }) }),
    defineField({ name: 'caption', title: 'Caption', type: 'text', rows: 2 }),
    defineField({ name: 'thumbnail', title: 'Thumbnail', type: 'image', options: { hotspot: true }, description: 'Displayed image — post screenshot or operator upload.' }),
    defineField({ name: 'order', title: 'Display Order', type: 'number' }),
    defineField({ name: 'embedHtml', title: 'Embed HTML', type: 'text', rows: 3, hidden: true, description: 'Reserved for post-sale live embeds. Unused by the curated gallery.' }),
  ],
  preview: { select: { title: 'platform', subtitle: 'caption', media: 'thumbnail' } },
});

/**
 * Durable record of operator-approved content migrated from the prospect's
 * existing website. The spec-site-builder reads this on rebuild and overlays
 * it onto generated content (after lint) so a regen never clobbers approved
 * real copy/images. Asset ids are stored as plain strings; the builder
 * re-attaches them as image references on the doc.
 */
export const bsMigrated = defineType({
  name: 'bsMigrated',
  title: 'Migrated Content',
  type: 'object',
  fields: [
    defineField({ name: 'headline', title: 'Hero Headline', type: 'string' }),
    defineField({ name: 'aboutBody', title: 'About Body', type: 'text', rows: 5 }),
    defineField({ name: 'services', title: 'Services', type: 'array', of: [{ type: 'bsServiceCard' }] }),
    defineField({ name: 'socials', title: 'Social Links', type: 'array', of: [{ type: 'bsSocialLink' }] }),
    defineField({ name: 'logoAssetId', title: 'Logo Asset ID', type: 'string', description: 'Sanity asset _id for the migrated logo.' }),
    defineField({ name: 'heroImageAssetId', title: 'Hero Image Asset ID', type: 'string' }),
    defineField({ name: 'aboutImageAssetId', title: 'About Image Asset ID', type: 'string' }),
    defineField({
      name: 'ugc',
      title: 'Social Gallery Items',
      type: 'array',
      of: [{ type: 'bsMigratedUgcItem' }],
      description: 'Approved social-proof items, re-materialized as a bsUgcSection on rebuild.',
    }),
    defineField({ name: 'source', title: 'Source URL', type: 'url', description: 'The crawled website this content came from (provenance).' }),
    defineField({ name: 'migratedAt', title: 'Approved At', type: 'datetime' }),
  ],
  preview: { prepare: () => ({ title: 'Migrated Content' }) },
});

/**
 * A migrated UGC item as stored in the durable `bsMigrated.ugc` overlay.
 * Holds the thumbnail as a plain asset id (re-attached as an image ref when
 * the builder materializes the bsUgcSection) rather than an inline image.
 */
export const bsMigratedUgcItem = defineType({
  name: 'bsMigratedUgcItem',
  title: 'Migrated UGC Item',
  type: 'object',
  fields: [
    defineField({ name: 'platform', title: 'Platform', type: 'string' }),
    defineField({ name: 'postUrl', title: 'Post URL', type: 'url' }),
    defineField({ name: 'caption', title: 'Caption', type: 'text', rows: 2 }),
    defineField({ name: 'thumbnailAssetId', title: 'Thumbnail Asset ID', type: 'string' }),
  ],
  preview: { select: { title: 'platform', subtitle: 'caption' } },
});

/**
 * Machine-written overlay recording how the customer has structured their page.
 * Written by the customer portal (Workstream D) and the build/persist layer
 * (Workstream C). Never operator-edited — hidden in Studio.
 *
 * - `sectionOrder`: ordered list of section `_key`s as the customer arranged them.
 * - `removedKeys`: section `_key`s the customer deleted; builder skips these on merge.
 * - `customerOwnedKeys`: section `_key`s the customer has edited or added; builder
 *   preserves these verbatim on rebuild rather than regenerating.
 * - `lockedAt`: set when the site goes live/handed off (`status='live'`); signals
 *   the build layer to refuse destructive rebuilds.
 */
export const bsCustomerLayout = defineType({
  name: 'bsCustomerLayout',
  title: 'Customer Layout',
  type: 'object',
  hidden: true,
  description: 'Machine-written section-order overlay. Do not edit manually.',
  fields: [
    defineField({
      name: 'sectionOrder',
      title: 'Section Order',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Ordered list of section _key values as the customer arranged them.',
    }),
    defineField({
      name: 'removedKeys',
      title: 'Removed Keys',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Section _key values the customer deleted. Builder skips these on merge.',
    }),
    defineField({
      name: 'customerOwnedKeys',
      title: 'Customer Owned Keys',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Section _key values the customer has edited or added. Builder preserves these verbatim on rebuild.',
    }),
    defineField({
      name: 'lockedAt',
      title: 'Locked At',
      type: 'datetime',
      description: 'Set when the site goes live/handed off. Triggers destructive-rebuild protection in the build layer.',
    }),
  ],
  preview: { prepare: () => ({ title: 'Customer Layout' }) },
});

export const buildsellObjectTypes = [
  bsCtaButton,
  bsServiceCard,
  bsPricingTier,
  bsProcessStep,
  bsTrustBadge,
  bsStatItem,
  bsNavLink,
  bsFooterColumn,
  bsSocialLink,
  bsAddress,
  bsSeo,
  bsFormLabels,
  bsUgcItem,
  bsMigrated,
  bsMigratedUgcItem,
  bsCustomerLayout,
];
