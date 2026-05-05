import { createWriteClient } from '@leadlandlord/sanity-schema';

export interface UploadHeroImageResult {
  /** Sanity asset _id (e.g. `image-abc123-1536x896-jpg`). */
  assetId: string;
  /** Public CDN URL for the asset. */
  url: string;
  /** Bytes uploaded. */
  size: number;
}

/**
 * Upload a hero image buffer to Sanity assets. Returns the new asset's
 * Sanity _id + CDN URL. Caller patches the site doc with
 * `heroImage.asset._ref = assetId`.
 *
 * Sanity content-addresses by SHA-256, so re-uploading the exact same buffer
 * for the same site is a no-op (returns the existing asset id).
 */
export async function uploadHeroImage(
  siteId: string,
  buffer: Buffer,
  filename = `hero-${siteId}.jpg`,
  contentType = 'image/jpeg',
): Promise<UploadHeroImageResult> {
  const client = createWriteClient();
  const asset = await client.assets.upload('image', buffer, { filename, contentType });
  return { assetId: asset._id, url: asset.url, size: buffer.byteLength };
}
