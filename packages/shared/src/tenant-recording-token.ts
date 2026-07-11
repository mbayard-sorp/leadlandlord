/**
 * Signed-token helpers for the tenant-facing call-recording proxy (ADR 0031,
 * Phase D). Tenants read their qualified-lead email days later, so recording
 * links carry a long-lived (7-day) signed token rather than requiring an
 * operator session.
 *
 * Token shape: `${expUnixSeconds}.${hexHmacSha256(secret, callId + '.' + exp)}`
 *
 * Mirrors the pattern in apps/site-host/lib/bs-preview-token.ts (timing-safe
 * compare, secret-absent-means-invalid). Server-side only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

function sign(secret: string, callId: string, exp: number): string {
  return createHmac('sha256', secret).update(`${callId}.${exp}`).digest('hex');
}

/**
 * Produce a `?t=` query value good for 7 days from now (or `ttlSeconds` if
 * given). Throws if `secret` is empty — callers should check env presence
 * before offering a recording link at all.
 */
export function signRecordingToken(
  callId: string,
  secret: string,
  ttlSeconds: number = SEVEN_DAYS_S,
): string {
  if (!secret) throw new Error('signRecordingToken requires a non-empty secret');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${exp}.${sign(secret, callId, exp)}`;
}

/**
 * Verify a `?t=` token for `callId`. Returns false (never throws) when the
 * secret is absent, the token is malformed, expired, or the signature
 * doesn't match.
 */
export function verifyRecordingToken(
  callId: string,
  token: string | null | undefined,
  secret: string | undefined,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !token) return false;

  const dot = token.indexOf('.');
  if (dot <= 0) return false;

  const expPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  const exp = Number.parseInt(expPart, 10);
  if (!Number.isFinite(exp) || String(exp) !== expPart) return false;
  if (exp < now) return false;

  const expected = sign(secret, callId, exp);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(sigPart, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
