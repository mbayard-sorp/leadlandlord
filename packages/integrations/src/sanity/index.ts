/**
 * Sanity integration surface for the agent runtime + operator dashboard.
 * Re-exports the schema package's typed write/read clients alongside
 * convenience helpers (asset-upload).
 *
 * Purpose: keep "Sanity is just one of N integrations" intent — agents
 * import from @leadlandlord/integrations/sanity, not directly from the
 * schema package, so swapping CMS providers later is a one-file change.
 */
export { createReadClient, createWriteClient, siteDocId, pageDocId, themeDocId } from '@leadlandlord/sanity-schema';
export type { SanityClientOptions, PageKind, ThemeName } from '@leadlandlord/sanity-schema';

export { uploadHeroImage } from './asset-upload';
export type { UploadHeroImageResult } from './asset-upload';
