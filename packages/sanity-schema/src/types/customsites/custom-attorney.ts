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
    defineField({
      name: 'credentials',
      title: 'Credentials',
      type: 'array',
      of: [{ type: 'csCredential' }],
      description: 'Certifications and appointments that are not a bar admission (AAA/ICC certifications, judicial-reference appointments, etc.) — feeds hasCredential JSON-LD generically. Bar admissions belong in Bar Admissions below, not here.',
    }),
    defineField({
      name: 'barAdmissions',
      title: 'Bar Admissions',
      type: 'array',
      of: [{ type: 'csBarAdmission' }],
      description: 'Structured bar admissions (jurisdiction, optional bar number/year). Maps to hasCredential\'s credentialCategory: "license" + recognizedBy schema.org shape; jurisdiction is stored separately from the credential name so it can be queried on its own.',
    }),
    defineField({
      name: 'arbitratorPanels',
      title: 'Arbitrator Panels',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Panel memberships, e.g. "AAA Panel of Arbitrators", "JAMS Neutral", court-appointed panels. Feeds memberOf / hasCredential JSON-LD. No sub-structure — panel membership doesn\'t carry a per-entry date/issuer the way Credentials does.',
    }),
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
