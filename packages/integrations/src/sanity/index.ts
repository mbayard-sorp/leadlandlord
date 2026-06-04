/**
 * Sanity integration surface for the agent runtime + operator dashboard.
 * Re-exports the schema package's typed write/read clients alongside
 * convenience helpers (asset-upload).
 *
 * Purpose: keep "Sanity is just one of N integrations" intent — agents
 * import from @leadlandlord/integrations/sanity, not directly from the
 * schema package, so swapping CMS providers later is a one-file change.
 */
// Re-export from the light subpaths (./client, ./ids) rather than the package
// main entry. The main entry pulls in ./types/* which `import from 'sanity'`
// (Studio + CSS side effects), crashing any standalone `tsx`/Node context that
// imports an agent. The subpaths expose the same client + id helpers without
// the Studio import, so the agent runtime stays runnable outside Next.js.
export { createReadClient, createWriteClient } from '@leadlandlord/sanity-schema/client';
export type { SanityClientOptions } from '@leadlandlord/sanity-schema/client';
export { siteDocId, pageDocId, themeDocId } from '@leadlandlord/sanity-schema/ids';
export type { PageKind, ThemeName } from '@leadlandlord/sanity-schema/ids';

export { uploadHeroImage, uploadArticleImage, uploadFile } from './asset-upload';
export type { UploadHeroImageResult } from './asset-upload';
