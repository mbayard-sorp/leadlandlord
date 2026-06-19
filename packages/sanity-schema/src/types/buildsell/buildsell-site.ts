import { defineType, defineField } from 'sanity';

/**
 * A Build & Sell spec site — ONE document per business (NOT a singleton).
 * Folds the design's `page` + `siteSettings` into a single multi-doc type.
 * Deterministic id `bs-site-${buildsellSiteId}`.
 *
 * `draftMode` (default true) drives the DraftShield watermark + noindex;
 * `robotsDisallow` (default true) is the Sanity layer of the triple-defense
 * noindex. The spec-site-builder agent writes both true; markPaid flips them.
 */
export const buildsellSite = defineType({
  name: 'buildsellSite',
  title: 'Build & Sell Site',
  type: 'document',
  fields: [
    defineField({ name: 'buildsellSiteId', title: 'Build & Sell Site ID', type: 'string', description: 'Postgres buildsell_sites.id (uuid).', validation: (r) => r.required() }),
    defineField({ name: 'placeId', title: 'Google Place ID', type: 'string', description: 'Google Places place_id. Powers the "View on Google Maps" link and LocalBusiness sameAs.' }),
    defineField({ name: 'businessName', title: 'Business Name', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'trade', title: 'Trade', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State', type: 'string' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string' }),
    defineField({ name: 'ownerEmail', title: 'Owner Email', type: 'string', hidden: true, description: 'Operator-entered outreach target. Hidden from public rendering.' }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'businessName' } }),
    defineField({ name: 'navigation', title: 'Navigation', type: 'array', of: [{ type: 'bsNavLink' }] }),
    defineField({ name: 'theme', title: 'Theme', type: 'buildsellTheme' }),
    defineField({
      name: 'draftMode',
      title: 'Draft Mode',
      type: 'boolean',
      initialValue: true,
      description: 'True = watermarked draft + noindex. Flipped to false by Mark Paid.',
    }),
    defineField({
      name: 'robotsDisallow',
      title: 'Robots Disallow',
      type: 'boolean',
      initialValue: true,
      description: 'Sanity layer of the triple-defense noindex.',
    }),
    defineField({ name: 'seo', title: 'SEO', type: 'bsSeo' }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      of: [
        { type: 'bsHeroSection' },
        { type: 'bsServicesSection' },
        { type: 'bsAboutSection' },
        { type: 'bsProcessSection' },
        { type: 'bsReviewsSection' },
        { type: 'bsContactSection' },
        { type: 'bsFooterSection' },
      ],
    }),
    defineField({ name: 'generatedAt', title: 'Generated At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'businessName', city: 'city', draft: 'draftMode' },
    prepare: ({ title, city, draft }) => ({
      title: title ?? '(unnamed)',
      subtitle: [city, draft ? 'DRAFT' : 'LIVE'].filter(Boolean).join(' · '),
    }),
  },
});
