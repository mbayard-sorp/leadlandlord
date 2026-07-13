import { defineType, defineField } from 'sanity';

/**
 * keywordCluster — the unit of SEO planning. One cluster maps to one page.
 *
 * Lifecycle:
 *   1. keyword-planner agent generates clusters post-niche.approved using
 *      DataForSEO (related_keywords + keyword_suggestions). Status: 'planned'.
 *   2. site-builder reads clusters and passes them to Content Engine.
 *   3. Content Engine targets one page per cluster; persist-sanity sets
 *      targetPage + status='covered' (or 'gap' if Claude failed to target it).
 *   4. (Phase 4) SEO Operator monitors GSC + GA4. Underperforming clusters
 *      flip status='underperforming' and trigger a re-target event.
 *
 * Operator can edit:
 *   - Add operator-supplied keywords (source='operator') to refine targeting.
 *   - Mark cluster status='retired' to exclude it from future re-targets.
 *
 * Deterministic id: `cluster-${siteId}-${clusterKey}` so re-runs overwrite
 * in place.
 */
export const keywordCluster = defineType({
  name: 'keywordCluster',
  title: 'Keyword Cluster',
  type: 'document',
  fields: [
    defineField({
      name: 'siteId',
      title: 'Site ID',
      type: 'string',
      description: 'Postgres sites.id (UUID). Matches the parent site doc.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'site',
      title: 'Site',
      type: 'reference',
      to: [{ type: 'site' }],
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'clusterKey',
      title: 'Cluster Key',
      type: 'string',
      description:
        'Stable identifier within a site. Examples: "home-commercial", "service-pet-turf", "service-area-gilbert", "blog-cost-guide". Maps 1:1 to a page.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'pageKind',
      title: 'Page Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Home', value: 'home' },
          { title: 'Service', value: 'service' },
          { title: 'Service Area', value: 'service_area' },
          { title: 'Blog', value: 'blog' },
          { title: 'Info', value: 'info' },
          { title: 'FAQ', value: 'faq' },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'pillarKey',
      title: 'Pillar Cluster Key',
      type: 'string',
      description:
        'clusterKey of the service cluster this blog/info/faq cluster supports (topical pillar). Null/absent for service and home clusters or genuinely general topics.',
    }),
    defineField({
      name: 'intent',
      title: 'Search Intent',
      type: 'string',
      options: {
        list: [
          { title: 'Commercial', value: 'commercial' },
          { title: 'Informational', value: 'informational' },
          { title: 'Local Modifier', value: 'local-modifier' },
          { title: 'Navigational', value: 'navigational' },
          { title: 'Transactional', value: 'transactional' },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'primaryKeyword',
      title: 'Primary Keyword',
      type: 'string',
      description:
        'The single phrase the targeted page ranks for. Must appear in H1, meta description, slug, and first 100 words.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'keywords',
      title: 'Keywords',
      type: 'array',
      description:
        'All keywords in this cluster — primary first, then supporting. Volume + KD from DataForSEO.',
      of: [
        {
          type: 'object',
          fields: [
            defineField({ name: 'phrase', title: 'Phrase', type: 'string', validation: (r) => r.required() }),
            defineField({
              name: 'role',
              title: 'Role',
              type: 'string',
              options: { list: ['primary', 'secondary', 'supporting'] },
            }),
            defineField({ name: 'searchVolume', title: 'Search Volume', type: 'number' }),
            defineField({ name: 'kd', title: 'Keyword Difficulty (0-100)', type: 'number' }),
            defineField({ name: 'cpc', title: 'CPC (USD)', type: 'number' }),
            defineField({ name: 'competition', title: 'Competition (0-1)', type: 'number' }),
            defineField({
              name: 'intent',
              title: 'Intent',
              type: 'string',
              description: 'Per-keyword intent from DataForSEO Labs search_intent_info.main_intent',
            }),
            defineField({
              name: 'source',
              title: 'Source',
              type: 'string',
              options: {
                list: [
                  { title: 'DataForSEO related_keywords', value: 'related' },
                  { title: 'DataForSEO keyword_suggestions', value: 'suggestion' },
                  { title: 'Niche-hunter seed', value: 'seed' },
                  { title: 'Operator manual', value: 'operator' },
                ],
              },
            }),
          ],
          preview: {
            select: { title: 'phrase', role: 'role', vol: 'searchVolume', kd: 'kd' },
            prepare: ({ title, role, vol, kd }) => ({
              title: title ?? '(no phrase)',
              subtitle: `${role ?? '?'} · vol=${vol ?? '—'} kd=${kd ?? '—'}`,
            }),
          },
        },
      ],
    }),
    defineField({
      name: 'totalVolume',
      title: 'Total Volume',
      type: 'number',
      description: 'Sum of search_volume across all keywords in cluster. Used for ranking clusters by potential.',
    }),
    defineField({
      name: 'targetPage',
      title: 'Target Page',
      type: 'reference',
      to: [{ type: 'page' }],
      description:
        'Set by persist-sanity after Content Engine picks a page for this cluster. Null until covered.',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Planned (kw-planner emitted, not yet rendered)', value: 'planned' },
          { title: 'Covered (page targets this cluster)', value: 'covered' },
          { title: 'Gap (Content Engine failed to cover)', value: 'gap' },
          { title: 'Underperforming (live but not ranking)', value: 'underperforming' },
          { title: 'Retired (operator excluded from re-targets)', value: 'retired' },
        ],
      },
      initialValue: 'planned',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'fetchedAt',
      title: 'Fetched At',
      type: 'datetime',
      description: 'When DataForSEO was last queried for these keywords. Refresh cadence: 90 days.',
    }),
  ],
  preview: {
    select: {
      title: 'primaryKeyword',
      kind: 'pageKind',
      status: 'status',
      vol: 'totalVolume',
    },
    prepare: ({ title, kind, status, vol }) => ({
      title: title ?? '(no primary)',
      subtitle: `${kind} · ${status}${vol ? ` · vol=${vol}` : ''}`,
    }),
  },
});
