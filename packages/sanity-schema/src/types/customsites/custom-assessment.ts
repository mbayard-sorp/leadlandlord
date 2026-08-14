import { defineType, defineField } from 'sanity';

interface AssessmentQuestionOption {
  points?: number;
}

interface AssessmentQuestion {
  options?: AssessmentQuestionOption[];
}

interface AssessmentBand {
  minScore?: number;
  maxScore?: number;
}

interface AssessmentDocLike {
  questions?: AssessmentQuestion[];
  bands?: AssessmentBand[];
}

/**
 * A fully author-configurable quiz on a Custom Site (first use: Aligned
 * Advisors' "Wealth Journey" assessment). Question count, wording, options,
 * points, and the score→stage mapping are all author-owned — no hardcoded
 * question set in code. Embedded on pages via csAssessmentBlock.
 * Deterministic id `cs-assessment-${siteKey}-${slug}`.
 */
export const csAssessment = defineType({
  name: 'csAssessment',
  title: 'Assessment',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (r) => r.required(),
      description: 'Internal name, e.g. "Wealth Journey Quiz v1".',
    }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' }, validation: (r) => r.required() }),
    defineField({
      name: 'questions',
      title: 'Questions',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csAssessmentQuestion',
          title: 'Question',
          fields: [
            defineField({ name: 'prompt', title: 'Prompt', type: 'string', validation: (r) => r.required() }),
            defineField({ name: 'helpText', title: 'Help Text', type: 'string' }),
            defineField({
              name: 'options',
              title: 'Options',
              type: 'array',
              of: [
                {
                  type: 'object',
                  name: 'csAssessmentOption',
                  title: 'Option',
                  fields: [
                    defineField({ name: 'label', title: 'Label', type: 'string', validation: (r) => r.required() }),
                    defineField({
                      name: 'points',
                      title: 'Points',
                      type: 'number',
                      validation: (r) => r.required().min(0).max(10),
                      description: 'Higher points = further along the journey. The result is the band the total lands in.',
                    }),
                  ],
                  preview: { select: { title: 'label', subtitle: 'points' } },
                },
              ],
              validation: (r) => r.min(2).max(6),
            }),
          ],
          preview: { select: { title: 'prompt' } },
        },
      ],
      validation: (r) => r.min(3).max(25),
      description: 'Add, remove, reorder or reword questions freely — progress and scoring recompute from the array length and the points you set.',
    }),
    defineField({
      name: 'bands',
      title: 'Score Bands',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csAssessmentBand',
          title: 'Band',
          fields: [
            defineField({ name: 'stage', title: 'Stage', type: 'reference', to: [{ type: 'csJourneyStage' }], validation: (r) => r.required() }),
            defineField({ name: 'minScore', title: 'Min Score', type: 'number', validation: (r) => r.required().min(0) }),
            defineField({ name: 'maxScore', title: 'Max Score', type: 'number', validation: (r) => r.required().min(0) }),
            defineField({
              name: 'resultHeading',
              title: 'Result Heading',
              type: 'string',
              description: 'Overrides the stage title on the result screen. Optional.',
            }),
          ],
          preview: {
            select: { title: 'stage.title', min: 'minScore', max: 'maxScore' },
            prepare: ({ title, min, max }) => ({ title: title ?? '(no stage)', subtitle: `${min ?? '?'}–${max ?? '?'}` }),
          },
        },
      ],
      validation: (r) =>
        r.min(2).custom((bands, context) => {
          const doc = context.document as AssessmentDocLike | undefined;
          const typedBands = (bands ?? []) as AssessmentBand[];
          if (typedBands.length === 0) return true;
          const sorted = [...typedBands].sort((a, b) => (a.minScore ?? 0) - (b.minScore ?? 0));
          for (const band of sorted) {
            if (band.minScore == null || band.maxScore == null) return 'Every band needs a min and max score.';
            if (band.maxScore < band.minScore) return 'A band’s max score must be ≥ its min score.';
          }
          if ((sorted[0]?.minScore ?? 0) !== 0) return 'Bands must start at 0.';
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const cur = sorted[i];
            if (!prev || !cur) continue;
            if ((cur.minScore ?? 0) !== (prev.maxScore ?? 0) + 1) {
              return `Bands must be contiguous: a band must start at the previous band’s max + 1 (gap or overlap at ${cur.minScore}).`;
            }
          }
          const maxPossible = (doc?.questions ?? []).reduce((sum: number, q: AssessmentQuestion) => {
            const pts = (q.options ?? []).map((o) => o.points ?? 0);
            return sum + (pts.length ? Math.max(...pts) : 0);
          }, 0);
          const last = sorted[sorted.length - 1];
          if (last && maxPossible > 0 && (last.maxScore ?? 0) < maxPossible) {
            return `Bands must cover the maximum possible score (${maxPossible}); the last band ends at ${last.maxScore}.`;
          }
          return true;
        }),
      description: 'Score bands mapped to stages. Ranges must be contiguous and cover 0 to the maximum possible score.',
    }),
    defineField({ name: 'emailSubject', title: 'Email Subject', type: 'string', description: 'Subject line of the lead email sent to the site’s Lead Recipients when a visitor completes the assessment.' }),
    defineField({ name: 'emailIntro', title: 'Email Intro', type: 'text', rows: 2, description: 'Copy above the result details in the lead email.' }),
  ],
  preview: {
    select: { title: 'title', questions: 'questions', bands: 'bands' },
    prepare: ({ title, questions, bands }) => ({
      title: title ?? '(untitled)',
      subtitle: `${Array.isArray(questions) ? questions.length : 0} questions · ${Array.isArray(bands) ? bands.length : 0} bands`,
    }),
  },
});
