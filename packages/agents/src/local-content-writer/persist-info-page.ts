/**
 * Persist a single drafted info page to Sanity and patch it onto the site doc.
 *
 * CRITICAL: we NEVER createOrReplace the site doc — that would clobber every
 * field site-builder wrote. We only patch the infoPages array to append the
 * new reference. Mirror of persist-sanity.ts's keywordCluster patch pattern.
 */
import { createWriteClient, siteDocId, pageDocId } from '@leadlandlord/integrations/sanity';
import type { DraftedInfoPage } from '../shared/author-info-page';

interface PersistInfoPageResult {
  pageDocId: string;
  slug: string;
}

export async function persistInfoPage(
  siteId: string,
  slug: string,
  drafted: DraftedInfoPage,
): Promise<PersistInfoPageResult> {
  const client = createWriteClient();
  const siteRef = siteDocId(siteId);

  // Fetch current infoPages array length to compute the next free index.
  const siteDoc = await client.fetch<{ infoPages?: Array<unknown> } | null>(
    `*[_id == $siteDoc][0]{infoPages}`,
    { siteDoc: siteRef },
  );
  const currentCount = siteDoc?.infoPages?.length ?? 0;
  const idx = currentCount;
  const docId = pageDocId(siteId, 'info', idx);

  // Write the new page doc.
  await client.createOrReplace({
    _id: docId,
    _type: 'page',
    site: { _ref: siteRef, _type: 'reference' },
    kind: 'info',
    slug,
    title: drafted.title,
    metaDescription: drafted.metaDescription,
    h1: drafted.h1,
    mdx: drafted.mdx,
    // draftInfoPage already returns jsonLd as a stringified JSON string, and
    // the Sanity field is type 'text'. Do NOT re-stringify (that double-encodes).
    jsonLd: drafted.jsonLd,
  });

  // Patch-append the reference onto the site doc's infoPages array.
  // setIfMissing initializes the array when it's absent (first info page).
  await client
    .patch(siteRef)
    .setIfMissing({ infoPages: [] })
    .append('infoPages', [{ _key: `i${idx}`, _ref: docId, _type: 'reference' }])
    .commit();

  return { pageDocId: docId, slug };
}
