import { defineType, defineField } from 'sanity';

/**
 * A Custom Sites tenant — ONE document per standalone client-owned site (NOT
 * a singleton; the dataset will hold multiple as the line grows past the
 * first tenant, constructionadrservices.com). Deterministic id
 * `cs-site-${siteKey}`.
 *
 * Unlike R&R/B&S, Custom Sites are lift-and-shift rebuilds of an existing
 * practice's real site: real phone numbers, real bar-admission copy, real
 * attorney bios. There is no AI-generated placeholder content invariant here
 * beyond the standard "no fake testimonials/licenses" rule.
 */
export const csSite = defineType({
  name: 'csSite',
  title: 'Custom Site',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'images', title: 'Images & Brand' },
    { name: 'seo', title: 'SEO & Visibility' },
  ],
  fields: [
    defineField({
      name: 'siteKey',
      title: 'Site Key',
      type: 'string',
      group: 'content',
      description: 'Lowercase slug identifying this site, e.g. "construction-adr-services". Drives the deterministic doc id.',
      validation: (r) => r.required().regex(/^[a-z0-9-]+$/, { name: 'lowercase-kebab-case' }),
    }),
    defineField({ name: 'name', title: 'Business Name', type: 'string', group: 'content', validation: (r) => r.required() }),
    defineField({
      name: 'customDomain',
      title: 'Custom Domain',
      type: 'string',
      group: 'content',
      description: 'Bare apex domain, e.g. "constructionadrservices.com". No scheme, no "www" — www is stripped at resolve time.',
    }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'string', group: 'content' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string', group: 'content' }),
    defineField({ name: 'cellPhone', title: 'Cell Phone', type: 'string', group: 'content' }),
    defineField({ name: 'email', title: 'Email', type: 'string', group: 'content' }),
    defineField({ name: 'address', title: 'Address', type: 'csAddress', group: 'content' }),
    defineField({ name: 'mapUrl', title: 'Map URL', type: 'url', group: 'content', description: 'Link-out URL (e.g. Google Maps place link).' }),
    defineField({ name: 'mapEmbedUrl', title: 'Map Embed URL', type: 'url', group: 'content', description: 'Iframe embed URL for an inline map.' }),
    defineField({ name: 'geo', title: 'Geo', type: 'geopoint', group: 'content' }),
    defineField({ name: 'logo', title: 'Logo', type: 'image', group: 'images' }),
    defineField({ name: 'footerLogo', title: 'Footer Logo', type: 'image', group: 'images' }),
    defineField({
      name: 'bannerImage',
      title: 'Interior Page Banner',
      type: 'image',
      group: 'images',
      description: 'Background for interior page headers (practice areas, articles). Wide crop, subject on the right.',
      options: { hotspot: true },
    }),
    defineField({ name: 'favicon', title: 'Favicon', type: 'image', group: 'images' }),
    defineField({ name: 'ogImage', title: 'OG Image', type: 'image', group: 'images' }),
    defineField({ name: 'navigation', title: 'Navigation', type: 'array', of: [{ type: 'csNavLink' }], group: 'content' }),
    defineField({ name: 'footerNav', title: 'Footer Navigation', type: 'array', of: [{ type: 'csNavLink' }], group: 'content' }),
    defineField({
      name: 'leadRecipients',
      title: 'Lead Recipients',
      type: 'array',
      of: [{ type: 'string', validation: (r) => r.email() }],
      group: 'content',
      description: 'Email addresses that receive lead-form submissions.',
    }),
    defineField({ name: 'gtmContainerId', title: 'GTM Container ID', type: 'string', group: 'seo' }),
    defineField({ name: 'sameAs', title: 'Same As (Profiles)', type: 'array', of: [{ type: 'url' }], group: 'seo', description: 'Bar profile, GBP, LinkedIn, etc. — used for Organization/LegalService sameAs JSON-LD.' }),
    defineField({
      name: 'organizationType',
      title: 'Organization Type',
      type: 'string',
      group: 'seo',
      initialValue: 'LegalService',
      description: 'schema.org type used for the site JSON-LD (e.g. "LegalService").',
    }),
    defineField({ name: 'openingHours', title: 'Opening Hours', type: 'array', of: [{ type: 'string' }], group: 'content', description: 'schema.org openingHours strings, e.g. "Mo-Fr 09:00-17:00".' }),
    defineField({
      name: 'robotsDisallow',
      title: 'Robots Disallow',
      type: 'boolean',
      group: 'seo',
      initialValue: true,
      description: 'Launch-noindexed invariant: every Custom Site starts with robots disallowed and must be explicitly flipped off by an operator once the site is verified live-ready. Never launch a Custom Site with this false by default.',
    }),
    defineField({ name: 'redirects', title: 'Redirects', type: 'array', of: [{ type: 'csRedirect' }], group: 'seo', description: 'Legacy-URL redirects carried over from the migrated WordPress site.' }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo', group: 'seo' }),
  ],
  preview: {
    select: { title: 'name', domain: 'customDomain', disallow: 'robotsDisallow' },
    prepare: ({ title, domain, disallow }) => ({
      title: title ?? '(unnamed)',
      subtitle: [domain, disallow ? 'NOINDEX' : null].filter(Boolean).join(' · '),
    }),
  },
});
