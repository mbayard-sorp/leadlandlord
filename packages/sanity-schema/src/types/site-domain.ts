import { defineType, defineField } from 'sanity';

export const siteDomain = defineType({
  name: 'siteDomain',
  title: 'Site Domain',
  type: 'object',
  fields: [
    defineField({
      name: 'host',
      title: 'Host',
      type: 'string',
      description: 'e.g. example.com or www.example.com',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'isPrimary',
      title: 'Primary',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({
      name: 'verified',
      title: 'Verified',
      type: 'boolean',
      initialValue: false,
    }),
    defineField({
      name: 'attachedAt',
      title: 'Attached At',
      type: 'datetime',
    }),
  ],
  preview: {
    select: { host: 'host', isPrimary: 'isPrimary', verified: 'verified' },
    prepare: ({ host, isPrimary, verified }) => ({
      title: host ?? '(no host)',
      subtitle: `${isPrimary ? 'primary' : 'alias'} · ${verified ? 'verified' : 'pending'}`,
    }),
  },
});
