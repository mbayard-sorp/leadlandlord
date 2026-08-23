import { defineType, defineField } from 'sanity';
import { csSlugField } from './slug';

/**
 * A client-outcome case study on a Custom Site. A document — not an inline
 * block object — because results carry compliance weight: the hard
 * `approvedForUse` gate, an internal approval note, reuse across pages, and
 * a stable identity for a future detail page. csCaseStudyGridBlock renders
 * only documents with `approvedForUse: true` and silently skips the rest.
 * Deterministic id `cs-case-${siteKey}-${slug}`.
 */
export const csCaseStudy = defineType({
  name: 'csCaseStudy',
  title: 'Case Study',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({
      name: 'headline',
      title: 'Headline',
      type: 'string',
      validation: (r) => r.required(),
      description: 'The outcome in one line.',
    }),
    csSlugField('headline'),
    defineField({
      name: 'clientDescriptor',
      title: 'Client Descriptor',
      type: 'string',
      description: 'How to describe the client without naming them, e.g. "3-location group practice, Southwest".',
    }),
    defineField({ name: 'metricLabel', title: 'Metric Label', type: 'string', validation: (r) => r.required(), description: 'e.g. "Annual collections".' }),
    defineField({
      name: 'beforeValue',
      title: 'Before Value',
      type: 'string',
      validation: (r) => r.required(),
      description: 'Author-entered text: "$3.98M". A single-value outcome (e.g. "$61K/mo") goes here with After left empty.',
    }),
    defineField({ name: 'afterValue', title: 'After Value', type: 'string' }),
    defineField({ name: 'timeframe', title: 'Timeframe', type: 'string', description: 'e.g. "26 months".' }),
    defineField({ name: 'narrative', title: 'Narrative', type: 'csBody' }),
    defineField({
      name: 'approvedForUse',
      title: 'Approved For Use',
      type: 'boolean',
      initialValue: false,
      validation: (r) => r.required(),
      description: 'Only case studies with client written approval on file are published. The grid silently skips anything not approved.',
    }),
    defineField({
      name: 'approvalNote',
      title: 'Approval Note',
      type: 'string',
      description: 'Internal: who approved, when. Never rendered.',
    }),
    defineField({ name: 'stage', title: 'Journey Stage', type: 'reference', to: [{ type: 'csJourneyStage' }] }),
    defineField({ name: 'order', title: 'Order', type: 'number' }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo' }),
  ],
  orderings: [{ title: 'Display order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] }],
  preview: {
    select: { title: 'headline', before: 'beforeValue', after: 'afterValue', approved: 'approvedForUse' },
    prepare: ({ title, before, after, approved }) => ({
      title: title ?? '(untitled)',
      subtitle: [
        [before, after].filter(Boolean).join(' → '),
        approved ? null : 'NOT APPROVED',
      ]
        .filter(Boolean)
        .join(' · '),
    }),
  },
});
