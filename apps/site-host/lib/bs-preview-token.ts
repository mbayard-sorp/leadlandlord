/**
 * HMAC-SHA256 token verifier for the B&S buyer theme-save route.
 *
 * The operator side signs: HMAC-SHA256(BS_PREVIEW_HMAC_SECRET, `bs-theme:${siteId}`)
 * and sends the hex digest as a Bearer token or ?t= query param.
 *
 * Server-side only — never import from any client-side module.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify that `token` is the correct HMAC-SHA256 hex digest for the given
 * siteId. Returns false when:
 *  - BS_PREVIEW_HMAC_SECRET env var is absent
 *  - token is absent / not a string
 *  - lengths differ (timing-safe path requires equal-length buffers)
 *  - HMAC mismatch
 */
export function verifyBsPreviewToken(
  siteId: string,
  token: string | null | undefined,
): boolean {
  const secret = process.env.BS_PREVIEW_HMAC_SECRET;
  if (!secret || !token) return false;

  const expected = createHmac('sha256', secret)
    .update(`bs-theme:${siteId}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const tokenBuf = Buffer.from(token, 'utf8');

  // timingSafeEqual requires equal-length buffers — mismatch means invalid.
  if (expectedBuf.length !== tokenBuf.length) return false;

  return timingSafeEqual(expectedBuf, tokenBuf);
}
