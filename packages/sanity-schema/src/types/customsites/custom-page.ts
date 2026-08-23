import { defineType, defineField } from 'sanity';
import { csSlugField } from './slug';

/**
 * A single page on a Custom Site. Deterministic id `cs-page-${siteKey}-${slug}`.
 */
export const csPage = defineType({
  name: 'csPage',
  title: 'Custom Page',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required() }),
    csSlugField('title'),
    defineField({
      name: 'bannerImage',
      title: 'Header Banner',
      type: 'image',
      options: { hotspot: true },
      description: 'Wide photo behind the interior page header. Falls back to the site default banner when empty.',
    }),
    defineField({
      name: 'pageBuilder',
      title: 'Page Builder',
      type: 'array',
      of: [
        { type: 'csHeroBlock' },
        { type: 'csIntroBlock' },
        { type: 'csPracticeGridBlock' },
        { type: 'csAttorneyBlock' },
        { type: 'csTestimonialsBlock' },
        { type: 'csBadgeRowBlock' },
        { type: 'csPublicationsBlock' },
        { type: 'csCalloutBlock' },
        { type: 'csRichTextBlock' },
        { type: 'csContactCtaBlock' },
        { type: 'csCtaBannerBlock' },
        { type: 'csFaqBlock' },
        { type: 'csStatRailBlock' },
        { type: 'csValuePropsBlock' },
        { type: 'csJourneyBlock' },
        { type: 'csCompareBlock' },
        { type: 'csTeamGridBlock' },
        { type: 'csFocusAreaListBlock' },
        { type: 'csCaseStudyGridBlock' },
        { type: 'csNumbersIqBlock' },
        { type: 'csLeadMagnetBlock' },
        { type: 'csTabbedInsightsBlock' },
        { type: 'csEpisodeListBlock' },
        { type: 'csAssessmentBlock' },
        { type: 'csDisclosureBlock' },
      ],
    }),
    defineField({ name: 'seo', title: 'SEO', type: 'csSeo' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
    defineField({ name: 'modifiedAt', title: 'Modified At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title', slug: 'slug.current', site: 'site.name' },
    prepare: ({ title, slug, site }) => ({
      title: title ?? '(untitled)',
      subtitle: [site, slug ? `/${slug}` : null].filter(Boolean).join(' · '),
    }),
  },
});
