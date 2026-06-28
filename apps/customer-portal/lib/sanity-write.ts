import 'server-only';

/**
 * Sanity write helpers for the customer portal.
 *
 * All functions are server-only. Never import this from a Client Component.
 *
 * The write client uses `perspective:'raw'` so it can read draft docs that
 * have not yet been published.
 *
 * Doc ID convention (from packages/sanity-schema/src/ids.ts):
 *   publishedId = `bs-site-<uuid>`
 *   draftId     = `drafts.bs-site-<uuid>`
 */

import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';

// Re-export for convenience so callers don't need a second import.
export { buildsellSiteDocId };

// ---------------------------------------------------------------------------
// Image upload allowlist
// ---------------------------------------------------------------------------

/**
 * Maps the customer-facing fieldKey to the granular Sanity draft patch path.
 * ONLY these four targets are permitted. Any other key is rejected at the
 * server action boundary and again here.
 */
const IMAGE_FIELD_PATHS: Record<string, string> = {
  'logo':         'logo',
  'favicon':      'favicon',
  'hero.image':   'sections[_key=="hero"].image',
  'about.image':  'sections[_key=="about"].image',
  'seo.ogImage':  'seo.ogImage',
} as const;

export type ImageFieldKey = keyof typeof IMAGE_FIELD_PATHS;

// ---------------------------------------------------------------------------
// Document read
// ---------------------------------------------------------------------------

/**
 * Returns the current editable doc: draft if it exists, else published.
 * Used to prefill the form AND to resolve sub-array `_key` values before
 * building granular patch paths.
 *
 * Returns `null` if neither draft nor published doc exists (e.g. the site
 * hasn't been built yet).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getEditableDoc(siteId: string): Promise<Record<string, any> | null> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const draftId = `drafts.${publishedId}`;

  const draft = await client.getDocument(draftId);
  if (draft) return draft;

  const published = await client.getDocument(publishedId);
  return published ?? null;
}

// ---------------------------------------------------------------------------
// Draft management helper
// ---------------------------------------------------------------------------

/**
 * Ensures a draft document exists for the given site.
 * If a draft already exists, this is a no-op.
 * If only a published doc exists, forks it as the new draft.
 * If neither exists, creates an empty shell so subsequent patches have
 * something to land on.
 *
 * Returns the draftId for convenience.
 */
async function ensureDraft(siteId: string): Promise<string> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const draftId = `drafts.${publishedId}`;

  const existingDraft = await client.getDocument(draftId);
  if (!existingDraft) {
    const published = await client.getDocument(publishedId);
    const base = published
      ? { ...published, _id: draftId }
      : { _id: draftId, _type: 'buildsellSite' };
    await client.createIfNotExists(base);
  }

  return draftId;
}

// ---------------------------------------------------------------------------
// Save (patch draft)
// ---------------------------------------------------------------------------

/**
 * Patches the draft doc with `patchSet` (granular Sanity path -> value map).
 *
 * If no draft exists yet, forks one from the published doc first
 * (`createIfNotExists`) so the publish flow always operates on a real draft.
 *
 * Commits with `visibility:'async'` — the patch is durable but we don't wait
 * for replication. The preview iframe will reflect the change shortly after.
 */
export async function saveFields(
  siteId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patchSet: Record<string, any>,
): Promise<void> {
  const draftId = await ensureDraft(siteId);
  const client = createWriteClient();
  // Synchronous so the change is durable before the editor reloads the live
  // preview — an async commit races the iframe refresh and looks like a no-op.
  await client.patch(draftId).set(patchSet).commit({ visibility: 'sync' });
}

// ---------------------------------------------------------------------------
// Image upload
// ---------------------------------------------------------------------------

/**
 * Accepted MIME types for customer image uploads.
 * favicon is kept to png for simplicity (no image/x-icon).
 */
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export interface UploadImageResult {
  assetId: string;
  /** Sanity CDN URL for the uploaded asset. */
  assetUrl: string;
}

/**
 * Validates, uploads, and patches a single image field on the draft.
 *
 * @param siteId    - The buildsell site UUID.
 * @param fieldKey  - One of 'logo' | 'favicon' | 'hero.image' | 'about.image'.
 * @param file      - The raw file data (buffer, filename, contentType).
 *
 * Throws with a descriptive message on validation failures.
 * Returns the new asset id and CDN URL on success.
 */
export async function uploadAndSetImage(
  siteId: string,
  fieldKey: string,
  file: {
    buffer: Buffer | Uint8Array;
    filename: string;
    contentType: string;
  },
): Promise<UploadImageResult> {
  // 1. Allowlist check.
  if (!(fieldKey in IMAGE_FIELD_PATHS)) {
    throw new Error(`Image field '${fieldKey}' is not permitted.`);
  }
  const sanityPath = IMAGE_FIELD_PATHS[fieldKey]!;

  // 2. Type validation (server-side, declared contentType).
  if (!ALLOWED_IMAGE_TYPES.has(file.contentType)) {
    throw new Error(
      `File type '${file.contentType}' is not allowed. Accepted: JPEG, PNG, WebP.`,
    );
  }

  // 3. Size validation.
  const byteLength = file.buffer instanceof Buffer
    ? file.buffer.length
    : file.buffer.byteLength;
  if (byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `File is too large (${(byteLength / 1024 / 1024).toFixed(1)} MB). Maximum is 8 MB.`,
    );
  }

  // 3b. Magic-byte validation — verify actual file bytes regardless of the
  //     browser-declared contentType (defense against MIME confusion attacks).
  //     PNG:  89 50 4E 47 0D 0A 1A 0A
  //     JPEG: FF D8 FF
  //     WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 ("RIFF....WEBP")
  const buf = file.buffer instanceof Buffer
    ? file.buffer
    : Buffer.from(file.buffer);
  const isPng =
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const isJpeg =
    buf.length >= 3 &&
    buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp =
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (!isPng && !isJpeg && !isWebp) {
    throw new Error(
      'File content does not match a recognised image format. Only PNG, JPEG, and WebP are accepted.',
    );
  }

  // 4. Ensure the draft exists before patching.
  const draftId = await ensureDraft(siteId);
  const client = createWriteClient();

  // 5. Upload asset to Sanity media library.
  //    Use the already-materialised `buf` from the magic-byte check above.
  const asset = await client.assets.upload(
    'image',
    buf,
    { filename: file.filename, contentType: file.contentType },
  );

  const assetId = asset._id;

  // 6. Patch the draft with the image reference.
  const imageRef = {
    _type: 'image',
    asset: {
      _type: 'reference',
      _ref: assetId,
    },
  };

  await client.patch(draftId).set({ [sanityPath]: imageRef }).commit({ visibility: 'async' });

  // 7. Build CDN URL from asset id.
  // asset._id format: "image-<hash>-<dimensions>-<ext>"
  // CDN URL: https://cdn.sanity.io/images/<projectId>/<dataset>/<hash>-<dimensions>.<ext>
  const projectId = process.env.SANITY_PROJECT_ID ?? process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '';
  const dataset = process.env.SANITY_DATASET ?? process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production';
  // Strip the leading "image-" prefix and replace the last "-" before ext with "."
  const refPart = assetId.replace(/^image-/, '');
  // refPart looks like: "<hash>-<WxH>-<ext>", last segment is the extension
  const lastDash = refPart.lastIndexOf('-');
  const withoutExt = refPart.substring(0, lastDash);
  const ext = refPart.substring(lastDash + 1);
  const assetUrl = `https://cdn.sanity.io/images/${projectId}/${dataset}/${withoutExt}.${ext}`;

  return { assetId, assetUrl };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

/**
 * Promotes the draft to published.
 *
 * SAFETY LOCK: sets `draftMode:false` and `robotsDisallow:false` on the
 * draft before promoting, so the live doc is never accidentally noindexed.
 * This is a synchronous commit so it lands before the action fires.
 */
export async function publishSite(siteId: string): Promise<void> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const draftId = `drafts.${publishedId}`;

  // Guarantee a draft exists before we patch/promote it. Without this, a
  // customer who hits Publish without first saving (no draft yet) would hit
  // "document not found" on the safety-lock patch below. ensureDraft forks
  // from the published doc when needed and is a no-op when a draft exists.
  await ensureDraft(siteId);

  // Safety lock — synchronous so it completes before the action.
  await client
    .patch(draftId)
    .set({ draftMode: false, robotsDisallow: false })
    .commit({ visibility: 'sync' });

  // Promote draft -> published atomically via the document actions API.
  await client.action({
    actionType: 'sanity.action.document.publish',
    publishedId,
    draftId,
  });
}

// ---------------------------------------------------------------------------
// Discard
// ---------------------------------------------------------------------------

/**
 * Discards the draft, reverting to the last published state.
 * No-op if there is no draft.
 */
export async function discardDraft(siteId: string): Promise<void> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const draftId = `drafts.${publishedId}`;

  // Use the discard action (preferred over delete — preserves history).
  try {
    await client.action({
      actionType: 'sanity.action.document.discard',
      draftId,
    });
  } catch {
    // If the action fails (e.g. no draft), fall back to a plain delete.
    await client.delete(draftId);
  }
}

// ---------------------------------------------------------------------------
// AI image-generation usage counter
//
// Stored on the PUBLISHED doc (not the draft) so a customer can't reset their
// quota by discarding the draft. Enforced server-side in the generate action.
// ---------------------------------------------------------------------------

/** Hard cap on customer AI image generations per site. */
export const AI_IMAGE_GENERATION_LIMIT = 5;

/** Current number of AI images this site has generated (0 if never). */
export async function getAiImageGenerationCount(siteId: string): Promise<number> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const doc = (await client.getDocument(publishedId)) as
    | { aiImageGenerations?: number }
    | undefined;
  const n = doc?.aiImageGenerations;
  return typeof n === 'number' && n > 0 ? n : 0;
}

/**
 * Atomically bumps the per-site generation counter on the published doc.
 * Returns the new total. Call only AFTER a generation has succeeded.
 */
export async function incrementAiImageGenerationCount(siteId: string): Promise<number> {
  const client = createWriteClient();
  const publishedId = buildsellSiteDocId(siteId);
  const res = await client
    .patch(publishedId)
    .setIfMissing({ aiImageGenerations: 0 })
    .inc({ aiImageGenerations: 1 })
    .commit({ visibility: 'sync' });
  const n = (res as unknown as { aiImageGenerations?: number }).aiImageGenerations;
  return typeof n === 'number' ? n : 0;
}
