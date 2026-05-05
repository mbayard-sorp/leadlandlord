import { defineType, defineField } from 'sanity';

/**
 * Singleton-style document holding global settings for the leadslandlord.com
 * corporate marketing site: brand identity, legal entity (used verbatim on
 * /privacy + /terms + footer), top nav, footer links, SMS disclosure.
 *
 * One doc per environment, deterministic id `corporate-site-leadslandlord`.
 * Distinct from `site` (per-tenant) so its shape can evolve without dragging
 * tenant content along.
 */
export const corporateSite = defineType({
  name: 'corporateSite',
  title: 'Corporate Site',
  type: 'document',
  fields: [
    defineField({
      name: 'brandName',
      title: 'Brand Name',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      description: 'Short one-liner under the logo / in social cards.',
    }),
    defineField({
      name: 'primaryHost',
      title: 'Primary Host',
      type: 'string',
      description: 'Canonical host (e.g. "leadslandlord.com") used for canonical URLs + sitemap.',
    }),
    defineField({
      name: 'legalEntity',
      title: 'Legal Entity',
      type: 'object',
      description:
        'Used verbatim in /privacy, /terms, footer, and on the Twilio A2P 10DLC application.',
      fields: [
        defineField({ name: 'name', title: 'Legal Name', type: 'string' }),
        defineField({ name: 'dba', title: 'DBA (if any)', type: 'string' }),
        defineField({ name: 'address', title: 'Mailing Address', type: 'text', rows: 3 }),
        defineField({ name: 'supportEmail', title: 'Support Email', type: 'string' }),
        defineField({ name: 'legalEmail', title: 'Legal / Privacy Email', type: 'string' }),
      ],
    }),
    defineField({
      name: 'navItems',
      title: 'Top Nav Items',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'href', title: 'Href', type: 'string', validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'label', subtitle: 'href' } },
        },
      ],
    }),
    defineField({
      name: 'footerLinks',
      title: 'Footer Links',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'href', title: 'Href', type: 'string', validation: (r) => r.required() }),
          ],
          preview: { select: { title: 'label', subtitle: 'href' } },
        },
      ],
    }),
    defineField({
      name: 'primaryCta',
      title: 'Primary CTA',
      type: 'object',
      description: 'Header + hero call-to-action button.',
      fields: [
        defineField({ name: 'label', title: 'Label', type: 'string' }),
        defineField({ name: 'href', title: 'Href', type: 'string' }),
      ],
    }),
    defineField({
      name: 'smsDisclosure',
      title: 'SMS Disclosure',
      type: 'text',
      rows: 4,
      description:
        'Verbatim block included on /privacy + /terms describing SMS data collection. Required for Twilio A2P 10DLC review.',
    }),
    defineField({
      name: 'gaMeasurementId',
      title: 'GA4 Measurement ID',
      type: 'string',
    }),
    defineField({
      name: 'robotsDisallow',
      title: 'Robots: Disallow All',
      type: 'boolean',
      initialValue: true,
      description: 'Lift after copy is final and A2P review is in progress.',
    }),
  ],
  preview: {
    select: { title: 'brandName', subtitle: 'primaryHost' },
  },
});
