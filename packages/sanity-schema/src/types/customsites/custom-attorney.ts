import { defineType, defineField } from 'sanity';

/**
 * An attorney/mediator profile on the Custom Site. `bioSections` mirrors the
 * migrated WordPress bio's repeater (Practice Areas / Organizations &
 * Achievements / Conflict Resolution Experience / Education & Training /
 * Awards) — each section has its own heading and Portable Text content
 * rather than one long `bio` blob.
 */
export const csAttorney = defineType({
  name: 'csAttorney',
  title: 'Attorney',
  type: 'document',
  fields: [
    defineField({ name: 'site', title: 'Site', type: 'reference', to: [{ type: 'csSite' }], validation: (r) => r.required() }),
    defineField({ name: 'name', title: 'Name', type: 'string', validation: (r) => r.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'name' }, validation: (r) => r.required() }),
    defineField({
      name: 'jobTitle',
      title: 'Job Title',
      type: 'string',
      description: 'e.g. "Mediator, Arbitrator, Judicial Reference, Discovery Referee, ADR Advocacy Consultant".',
    }),
    defineField({ name: 'photo', title: 'Photo', type: 'image', options: { hotspot: true } }),
    defineField({ name: 'bio', title: 'Bio (intro)', type: 'csBody', description: 'Short intro copy shown above the bio sections.' }),
    defineField({
      name: 'bioSections',
      title: 'Bio Sections',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'csBioSection',
          title: 'Bio Section',
          fields: [
            defineField({ name: 'heading', title: 'Heading', type: 'string', description: 'e.g. "Practice Areas", "Organizations & Achievements", "Conflict Resolution Experience", "Education & Training", "Awards".' }),
            defineField({ name: 'content', title: 'Content', type: 'csBody' }),
          ],
          preview: { select: { title: 'heading' } },
        },
      ],
    }),
    defineField({ name: 'credentials', title: 'Credentials', type: 'array', of: [{ type: 'string' }] }),
    defineField({ name: 'sameAs', title: 'Same As (Profiles)', type: 'array', of: [{ type: 'url' }] }),
    defineField({ name: 'email', title: 'Email', type: 'string' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string' }),
    defineField({ name: 'vCard', title: 'vCard', type: 'file' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'jobTitle', media: 'photo' },
    prepare: ({ title, subtitle, media }) => ({ title: title ?? '(unnamed)', subtitle, media }),
  },
});
