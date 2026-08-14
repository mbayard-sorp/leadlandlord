import { defineType, defineField } from 'sanity';

/**
 * One stage of a Custom Site's proprietary client-journey framework (first
 * use: Aligned Advisors' five-stage "Wealth Journey"). A document — not an
 * inline object — because the same stages are referenced by csJourneyBlock,
 * by every csAssessment result band, and by focus-area cross-links; inlining
 * them would mean authoring the copy 3-4 times and drifting immediately.
 * Deterministic id `cs-stage-${siteKey}-${slug}`.
 */
export const csJourneyStage = defineType({
  name: 'csJourneyStage',
  title: 'Journey Stage',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({
      name: 'order',
      title: 'Order',
      type: 'number',
      validation: (r) => r.required(),
      description: '1-5. Drives numbering everywhere the stage appears.',
    }),
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' }, validation: (r) => r.required() }),
    defineField({
      name: 'shortLabel',
      title: 'Short Label',
      type: 'string',
      description: 'Rail label when the full title is too long, e.g. "Invest".',
    }),
    defineField({
      name: 'summary',
      title: 'Summary',
      type: 'text',
      rows: 3,
      validation: (r) => r.required(),
      description: 'The 2-3 sentence description shown on the journey rail and as the assessment result body.',
    }),
    defineField({
      name: 'nextStageTeaser',
      title: 'Next Stage Teaser',
      type: 'text',
      rows: 2,
      description: '"What’s next for you" copy shown when a visitor lands on this stage. Optional.',
    }),
    defineField({
      name: 'focusAreas',
      title: 'Focus Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'csPracticeArea' }] }],
      description: 'Which focus areas serve this stage — powers "See how we help at this stage".',
    }),
    defineField({ name: 'body', title: 'Body', type: 'csBody', description: 'Optional long-form stage page.' }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo' }),
  ],
  orderings: [{ title: 'Stage order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] }],
  preview: {
    select: { title: 'title', order: 'order', site: 'site.name' },
    prepare: ({ title, order, site }) => ({
      title: title ?? '(untitled)',
      subtitle: [order != null ? `Stage ${order}` : null, site].filter(Boolean).join(' · '),
    }),
  },
});
