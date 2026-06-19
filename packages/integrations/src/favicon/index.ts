import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import type { UploadHeroImageResult } from '../sanity/asset-upload';

/**
 * Favicon generation for Build & Sell spec sites.
 *
 * No PNG rasterizer ships in this repo, so the favicon is a self-contained SVG
 * monogram (business initials on the preset's primary color). Modern browsers
 * render SVG favicons natively; Sanity stores SVG as a normal image asset and
 * serves it from the CDN. When a real logo asset exists the caller should
 * prefer that instead of a monogram (logo → favicon is higher fidelity).
 */

const STOP_WORDS = new Set([
  'the', 'and', 'of', 'co', 'inc', 'llc', 'ltd', 'corp', 'company', 'a', 'an', '&',
]);

/**
 * Up to two uppercase initials from the most significant words of a business
 * name. Drops stop-words and punctuation. Falls back to the first two letters
 * of a single word, or 'W' when nothing usable remains.
 */
export function faviconInitials(businessName: string): string {
  const words = businessName
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return 'W';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Build a 64x64 rounded-square SVG monogram. `bgHex` is the tile color (preset
 * primary); `fgHex` the text color (preset onPrimary, default white).
 */
export function faviconSvg(
  businessName: string,
  opts: { bgHex: string; fgHex?: string },
): string {
  const initials = faviconInitials(businessName);
  const fg = opts.fgHex ?? '#ffffff';
  // Two glyphs need a smaller size than one to stay inside the tile.
  const fontSize = initials.length > 1 ? 30 : 38;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
    `<rect width="64" height="64" rx="14" fill="${opts.bgHex}"/>`,
    `<text x="32" y="33" fill="${fg}" font-family="Inter,Arial,Helvetica,sans-serif"`,
    ` font-size="${fontSize}" font-weight="700" text-anchor="middle"`,
    ' dominant-baseline="central">',
    initials,
    '</text>',
    '</svg>',
  ].join('');
}

/**
 * Generate + upload a monogram favicon for a B&S site. Returns the Sanity asset
 * id + CDN URL. Content-addressed (SHA-256), so re-uploading an identical
 * monogram for the same site is a no-op.
 */
export async function generateAndUploadFavicon(
  siteId: string,
  businessName: string,
  opts: { bgHex: string; fgHex?: string },
): Promise<UploadHeroImageResult> {
  const svg = faviconSvg(businessName, opts);
  const buffer = Buffer.from(svg, 'utf8');
  const client = createWriteClient();
  const asset = await client.assets.upload('image', buffer, {
    filename: `bs-favicon-${siteId}.svg`,
    contentType: 'image/svg+xml',
  });
  return { assetId: asset._id, url: asset.url, size: buffer.byteLength };
}
