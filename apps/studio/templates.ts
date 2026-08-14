import type { Template } from 'sanity';

/**
 * Initial value templates for the Custom Sites per-site desk tree
 * (structure.ts). Each cs* content type gets a `<type>-for-site` template
 * parameterized by `siteId`, so a document created from inside a site folder
 * arrives with its `site` reference already set — the author never has to
 * pick the site by hand, and (future state) a customer editor scoped to one
 * folder can only create docs attached to their own site.
 *
 * A new cs* content type must be added here AND to CUSTOM_SITE_CHILD_TYPES
 * in structure.ts.
 */

const CUSTOM_SITE_CHILD_TEMPLATE_TYPES: ReadonlyArray<{ type: string; title: string }> = [
  { type: 'csPage', title: 'Page' },
  { type: 'csPracticeArea', title: 'Service' },
  { type: 'csAttorney', title: 'Team Member' },
  { type: 'csPublication', title: 'Publication / Episode' },
  { type: 'csJourneyStage', title: 'Journey Stage' },
  { type: 'csCaseStudy', title: 'Case Study' },
  { type: 'csAssessment', title: 'Assessment' },
  { type: 'csTestimonial', title: 'Testimonial' },
  { type: 'csBadge', title: 'Badge' },
];

export const customSiteTemplates: Template[] = CUSTOM_SITE_CHILD_TEMPLATE_TYPES.map(({ type, title }) => ({
  id: `${type}-for-site`,
  title,
  schemaType: type,
  parameters: [{ name: 'siteId', title: 'Site document id', type: 'string' }],
  value: ({ siteId }: { siteId: string }) => ({
    site: { _type: 'reference', _ref: siteId },
  }),
}));
