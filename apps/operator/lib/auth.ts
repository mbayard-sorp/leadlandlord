import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = '__ll_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface SessionPayload {
  exp: number; // ms epoch
  v: 1;
}

function secret(): string {
  const s = process.env.OPERATOR_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('OPERATOR_SESSION_SECRET must be set and at least 32 chars');
  }
  return s;
}

export function issueSession(): { name: string; value: string; maxAge: number } {
  const payload: SessionPayload = { exp: Date.now() + SESSION_TTL_MS, v: 1 };
  const value = signPayload(payload);
  return { name: COOKIE_NAME, value, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function verifySession(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts as [string, string];
  const expected = sign(b64);
  if (!safeEqualB64(sig, expected)) return false;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    const payload = JSON.parse(json) as SessionPayload;
    if (payload.v !== 1) return false;
    if (payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export async function requireOperatorSession(): Promise<void> {
  const cookie = (await cookies()).get(sessionCookieName())?.value;
  if (!verifySession(cookie)) {
    throw new Error('unauthorized');
  }
}

export function checkPassword(provided: string): boolean {
  const expected = process.env.OPERATOR_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sign a payload for cron→agent fan-out so the agent endpoint can trust it
 * came from our own dispatcher rather than a random external POST.
 */
export function signCronPayload(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function verifyCronSignature(body: string, sig: string | null): boolean {
  if (!sig) return false;
  const expected = signCronPayload(body);
  return safeEqualB64(sig, expected);
}

function signPayload(payload: SessionPayload): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function sign(input: string): string {
  return createHmac('sha256', secret()).update(input).digest('base64url');
}

function safeEqualB64(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
