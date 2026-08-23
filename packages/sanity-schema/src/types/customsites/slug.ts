import { defineField } from 'sanity';
import type { SlugIsUniqueValidator } from 'sanity';

/**
 * Custom Sites are many client sites sharing one dataset, so Sanity's default
 * slug uniqueness — which looks dataset-wide, ignoring the owning site — flags
 * every slug that two sites naturally share ("home", "contact", "privacy") as
 * "already in use". The routes are per-host, so those are not collisions at
 * all; the only slug that has to be unique is one within the same site and the
 * same document type.
 *
 * A doc with no site chosen yet (a brand-new one) falls back to type-wide
 * uniqueness rather than matching every other site-less draft in the dataset.
 */
const isUniqueWithinSite: SlugIsUniqueValidator = (slug, context) => {
  const { document, getClient } = context;
  if (!document) return true;
  const client = getClient({ apiVersion: '2024-01-01' });
  const publishedId = document._id.replace(/^drafts\./, '');
  const siteRef = (document as { site?: { _ref?: string } }).site?._ref ?? null;
  const siteClause = siteRef ? '&& site._ref == $siteRef' : '';
  const query = `!defined(*[!(_id in [$draft, $published]) && _type == $type && slug.current == $slug ${siteClause}][0]._id)`;
  return client.fetch<boolean>(query, {
    draft: `drafts.${publishedId}`,
    published: publishedId,
    slug,
    type: document._type,
    siteRef,
  });
};

/** The slug field every site-scoped Custom Sites document uses. */
export const csSlugField = (source: string) =>
  defineField({
    name: 'slug',
    title: 'Slug',
    type: 'slug',
    options: { source, isUnique: isUniqueWithinSite },
    validation: (r) => r.required(),
  });
