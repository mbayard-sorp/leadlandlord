import { defineType, defineField } from 'sanity';

export const review = defineType({
  name: 'review',
  title: 'Review',
  type: 'document',
  fields: [
    defineField({
      name: 'siteRef',
      title: 'Site',
      type: 'reference',
      to: [{ type: 'site' }],
      description: 'Back-reference to the site this review belongs to.',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'author',
      title: 'Author',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'rating',
      title: 'Rating',
      type: 'number',
      description: 'Integer 1–5.',
      validation: (r) => r.required().min(1).max(5),
    }),
    defineField({
      name: 'text',
      title: 'Review Text',
      type: 'text',
      rows: 4,
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
      options: {
        list: [
          { title: 'Google', value: 'google' },
          { title: 'Yelp', value: 'yelp' },
          { title: 'BBB', value: 'bbb' },
          { title: 'Facebook', value: 'facebook' },
          { title: 'Direct', value: 'direct' },
        ],
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'date',
      title: 'Review Date',
      type: 'date',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'verified',
      title: 'Verified',
      type: 'boolean',
      description: 'Only verified reviews are eligible for JSON-LD emission.',
      initialValue: false,
    }),
  ],
  preview: {
    select: {
      author: 'author',
      rating: 'rating',
      source: 'source',
      siteName: 'siteRef.businessName',
    },
    prepare: ({ author, rating, source, siteName }) => ({
      title: author ?? '(unnamed)',
      subtitle: [`${rating ?? '?'}/5`, source, siteName].filter(Boolean).join(' · '),
    }),
  },
});
