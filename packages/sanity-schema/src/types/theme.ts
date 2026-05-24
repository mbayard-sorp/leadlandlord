import { defineType, defineField } from 'sanity';

export const theme = defineType({
  name: 'theme',
  title: 'Theme',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      options: {
        list: [
          { title: 'Classic', value: 'classic' },
          { title: 'Modern', value: 'modern' },
          { title: 'Premium', value: 'premium' },
          { title: 'Bright', value: 'bright' },
          { title: 'Haul', value: 'haul' },
          { title: 'Counsel', value: 'counsel' },
        ],
        layout: 'radio',
      },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'displayName',
      title: 'Display Name',
      type: 'string',
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
    }),
  ],
  preview: {
    select: { title: 'displayName', subtitle: 'name' },
  },
});
