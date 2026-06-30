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
  // Tabs. The Studio auto-adds an "All fields" tab (the full flat form, so
  // nothing regresses); these gather the scattered image + visibility controls
  // into focused views. Hero/About/UGC images live inside the Sections array
  // (each section row now shows its image thumbnail) and OG image lives under
  // SEO — image fields nested in an object can't be hoisted into a doc group.
  groups: [
    { name: 'images', title: 'Images & Brand' },
    { name: 'seo', title: 'SEO & Visibility' },
  ],
  fields: [
    defineField({ name: 'buildsellSiteId', title: 'Build & Sell Site ID', type: 'string', description: 'Postgres buildsell_sites.id (uuid).', validation: (r) => r.required() }),
    defineField({ name: 'placeId', title: 'Google Place ID', type: 'string', description: 'Google Places place_id. Powers the "View on Google Maps" link and LocalBusiness sameAs.' }),
    defineField({ name: 'businessName', title: 'Business Name', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'trade', title: 'Trade', type: 'string' }),
    defineField({ name: 'city', title: 'City', type: 'string' }),
    defineField({ name: 'state', title: 'State', type: 'string' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string' }),
    defineField({ name: 'email', title: 'Email', type: 'string', description: 'Business contact email. Optional.' }),
    defineField({ name: 'address', title: 'Address', type: 'bsAddress', description: 'Doc-root address for display in hero/contact. Mirrors bsContactSection.address.' }),
    defineField({ name: 'rating', title: 'Google Rating', type: 'number', description: 'Aggregate star rating from Places API metadata. Non-PII.' }),
    defineField({ name: 'reviewCount', title: 'Review Count', type: 'number', description: 'Aggregate review count from Places API metadata. Non-PII.' }),
    defineField({ name: 'logo', title: 'Logo', type: 'image', options: { hotspot: true }, group: 'images', description: 'Business logo shown in the header (replaces the monogram). Upload or remove here.' }),
    defineField({
      name: 'logoSize',
      title: 'Logo Size (px)',
      type: 'number',
      group: 'images',
      description: 'Height of the logo in the header, in pixels. Leave blank for the default (36). Try 48–72 to make it larger. Width scales automatically to keep the logo’s proportions.',
      initialValue: 36,
      validation: (r) => r.min(16).max(160).integer(),
      hidden: ({ document }) => !document?.logo,
    }),
    defineField({
      name: 'navShowBusinessName',
      title: 'Show business name next to logo',
      type: 'boolean',
      group: 'images',
      initialValue: true,
      description: 'When off, the header shows the logo alone (no business-name text beside it). Best with a logo that already includes the name.',
      hidden: ({ document }) => !document?.logo,
    }),
    defineField({ name: 'favicon', title: 'Favicon', type: 'image', group: 'images', description: 'Browser tab icon. Auto-generated as an initials monogram on the preset color (or derived from the logo when one exists). Regenerable in the operator image panel.' }),
    defineField({ name: 'socials', title: 'Social Links', type: 'array', of: [{ type: 'bsSocialLink' }], description: 'Brand social profiles.' }),
    defineField({
      name: 'purchaseUrl',
      title: 'Purchase URL',
      type: 'url',
      validation: (r) => r.uri({ scheme: ['http', 'https'] }),
      description: 'Payment link threaded from buildsell_sites.payment_link. Set by sendInvoice.',
    }),
    defineField({ name: 'heroImagePrompt', title: 'Hero Image Prompt', type: 'text', rows: 3, group: 'images', description: 'Imagen prompt for the hero image. The rendered hero image is uploaded/removed under Sections → Hero → Image.' }),
    defineField({ name: 'aboutImagePrompt', title: 'About Image Prompt', type: 'text', rows: 3, group: 'images', description: 'Imagen prompt for the about section image. The rendered image is uploaded/removed under Sections → About → Image.' }),
    defineField({ name: 'ogImagePrompt', title: 'OG Image Prompt', type: 'text', rows: 3, group: 'images', description: 'Imagen prompt for the Open Graph (1:1) share image. The rendered image is under SEO → OG Image (SEO & Visibility tab).' }),
    defineField({ name: 'ownerEmail', title: 'Owner Email', type: 'string', hidden: true, description: 'Operator-entered outreach target. Hidden from public rendering.' }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'businessName' } }),
    defineField({ name: 'navigation', title: 'Navigation', type: 'array', of: [{ type: 'bsNavLink' }] }),
    defineField({ name: 'navShowPhone', title: 'Nav: Show Phone', type: 'boolean', initialValue: true, description: 'Show the click-to-call phone in the sticky nav.' }),
    defineField({ name: 'navCta', title: 'Nav: CTA Button', type: 'bsCtaButton', description: 'The nav action button (defaults to a "Get a Free Quote" → #contact button when empty).' }),
    defineField({ name: 'theme', title: 'Theme', type: 'buildsellTheme' }),
    defineField({
      name: 'draftMode',
      title: 'Draft Mode',
      type: 'boolean',
      initialValue: true,
      group: 'seo',
      description: 'True = watermarked draft + noindex. Flipped to false by Mark Paid.',
    }),
    defineField({
      name: 'robotsDisallow',
      title: 'Robots Disallow',
      type: 'boolean',
      initialValue: true,
      group: 'seo',
      description: 'Sanity layer of the triple-defense noindex.',
    }),
    defineField({
      name: 'themeLocked',
      title: 'Theme Locked',
      type: 'boolean',
      description: 'Set true when the buyer confirms their theme on the draft preview. Builder preserves theme.{preset,layoutVariant,fontHeading,fontBody} on rebuild while this is true.',
    }),
    defineField({ name: 'seo', title: 'SEO', type: 'bsSeo', group: 'seo', description: 'Meta title/description and the OG (social share) image. Upload or remove the OG image here.' }),
    defineField({
      name: 'migrated',
      title: 'Migrated Content',
      type: 'bsMigrated',
      description: 'Operator-approved content migrated from the prospect\'s existing site. Preserved across rebuilds (read-merge).',
    }),
    defineField({
      name: 'customerLayout',
      title: 'Customer Layout',
      type: 'bsCustomerLayout',
      hidden: true,
      description: 'Machine-written overlay recording customer section order, removals, and owned keys. Preserved across rebuilds (read-merge). Set lockedAt when site goes live.',
    }),
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
        { type: 'bsPricingSection' },
        { type: 'bsContactSection' },
        { type: 'bsFaqSection' },
        { type: 'bsUgcSection' },
        { type: 'bsHtmlSection' },
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
