import { defineType, defineField } from 'sanity';

export const site = defineType({
  name: 'site',
  title: 'Site',
  type: 'document',
  fields: [
    defineField({
      name: 'siteId',
      title: 'Site ID',
      type: 'string',
      description: 'Postgres sites.id (UUID). Source of truth for joining to operator DB.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'businessName', maxLength: 96 },
    }),
    defineField({
      name: 'businessName',
      title: 'Business Name',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'niche', title: 'Niche', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State', type: 'string' }),
    defineField({
      name: 'theme',
      title: 'Theme',
      type: 'reference',
      to: [{ type: 'theme' }],
      description: 'Swap = no redeploy.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'domains',
      title: 'Domains',
      type: 'array',
      of: [{ type: 'siteDomain' }],
    }),
    defineField({ name: 'gaMeasurementId', title: 'GA Measurement ID', type: 'string' }),
    defineField({
      name: 'robotsDisallow',
      title: 'Robots: Disallow All',
      type: 'boolean',
      initialValue: true,
      description: 'When true, robots.txt blocks indexing. Default true during warming.',
    }),
    defineField({
      name: 'trustSignals',
      title: 'Trust Signals',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({
      name: 'reviews',
      title: 'Reviews',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'review' }] }],
      description: 'Referenced review documents. Verified reviews are eligible for JSON-LD emission.',
    }),
    defineField({
      name: 'aggregateRating',
      title: 'Aggregate Rating',
      type: 'object',
      description: 'Emitted in JSON-LD only when reviewCount >= 3.',
      fields: [
        defineField({ name: 'ratingValue', title: 'Rating Value', type: 'number', validation: (r) => r.required().min(1).max(5) }),
        defineField({ name: 'reviewCount', title: 'Review Count', type: 'number', validation: (r) => r.required().min(0) }),
        defineField({ name: 'bestRating', title: 'Best Rating', type: 'number', initialValue: 5 }),
      ],
    }),
    defineField({
      name: 'licenseNumber',
      title: 'License Number',
      type: 'string',
    }),
    defineField({
      name: 'insuranceCarrier',
      title: 'Insurance Carrier',
      type: 'string',
    }),
    defineField({
      name: 'yearsInBusiness',
      title: 'Years in Business',
      type: 'number',
    }),
    defineField({
      name: 'responseTimePromise',
      title: 'Response Time Promise',
      type: 'string',
      description: 'e.g. "We respond within 2 hours"',
    }),
    defineField({
      name: 'certifications',
      title: 'Certifications',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'name', title: 'Name', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'issuer', title: 'Issuer', type: 'string' }),
            defineField({ name: 'year', title: 'Year', type: 'number' }),
          ],
          preview: {
            select: { title: 'name', issuer: 'issuer' },
            prepare: ({ title, issuer }) => ({ title: title ?? '(unnamed)', subtitle: issuer }),
          },
        },
      ],
    }),
    defineField({
      name: 'photoGallery',
      title: 'Photo Gallery',
      type: 'array',
      description: 'Maximum 8 images recommended to control Sanity CDN costs.',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'image', title: 'Image', type: 'image', options: { hotspot: true }, validation: (r) => r.required() }),
            defineField({ name: 'alt', title: 'Alt Text', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'caption', title: 'Caption', type: 'string' }),
          ],
          preview: {
            select: { title: 'alt', media: 'image' },
            prepare: ({ title, media }) => ({ title: title ?? '(no alt)', media }),
          },
        },
      ],
    }),
    defineField({
      name: 'guarantees',
      title: 'Guarantees',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'e.g. "100% satisfaction guarantee", "Licensed and insured"',
    }),
    defineField({
      name: 'nearbyCities',
      title: 'Nearby Cities',
      type: 'array',
      of: [{ type: 'string' }],
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'heroImagePrompt',
      title: 'Hero Image Prompt',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'home',
      title: 'Home Page',
      type: 'reference',
      to: [{ type: 'page' }],
    }),
    defineField({
      name: 'about',
      title: 'About Page',
      type: 'reference',
      to: [{ type: 'page' }],
    }),
    defineField({
      name: 'contact',
      title: 'Contact Page',
      type: 'reference',
      to: [{ type: 'page' }],
    }),
    defineField({
      name: 'services',
      title: 'Services',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'page' }] }],
    }),
    defineField({
      name: 'serviceAreas',
      title: 'Service Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'page' }] }],
    }),
    defineField({
      name: 'blogPosts',
      title: 'Blog Posts',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'page' }] }],
    }),
    defineField({
      name: 'infoPages',
      title: 'Info Pages',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'page' }] }],
    }),
    defineField({
      name: 'generatedAt',
      title: 'Generated At',
      type: 'datetime',
    }),
  ],
  preview: {
    select: {
      title: 'businessName',
      city: 'city',
      state: 'state',
      media: 'heroImage',
    },
    prepare: ({ title, city, state, media }) => ({
      title: title ?? '(unnamed site)',
      subtitle: [city, state].filter(Boolean).join(', '),
      media,
    }),
  },
});
