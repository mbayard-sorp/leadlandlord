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

export const buildsellObjectTypes = [
  bsCtaButton,
  bsServiceCard,
  bsProcessStep,
  bsTrustBadge,
  bsStatItem,
  bsNavLink,
  bsFooterColumn,
  bsSocialLink,
  bsAddress,
  bsSeo,
];
