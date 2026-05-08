import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Shared Google service-account JWT helper.
 *
 * Reads credentials from one of:
 *   - `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` — base64-encoded JSON OR raw JSON
 *   - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — path to a JSON file on disk
 *
 * Returns a memoized `JWT` instance per scope-set so we don't re-instantiate
 * on every call. Used by Google Search Console + GA4 Data API integrations.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

let parsedKeyCache: ServiceAccountKey | null = null;
const jwtCache = new Map<string, JWT>();

function parseKey(): ServiceAccountKey {
  if (parsedKeyCache) return parsedKeyCache;

  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  let raw: string;
  if (inline) {
    // Accept both base64-encoded JSON and raw JSON.
    const trimmed = inline.trim();
    if (trimmed.startsWith('{')) {
      raw = trimmed;
    } else {
      try {
        raw = Buffer.from(trimmed, 'base64').toString('utf-8');
      } catch (e) {
        throw new IntegrationError(
          'google-auth',
          `Failed to base64-decode GOOGLE_SERVICE_ACCOUNT_KEY_JSON: ${(e as Error).message}`,
        );
      }
    }
  } else if (path) {
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (e) {
      throw new IntegrationError(
        'google-auth',
        `Failed to read GOOGLE_SERVICE_ACCOUNT_KEY_PATH=${path}: ${(e as Error).message}`,
      );
    }
  } else {
    throw new IntegrationError(
      'google-auth',
      'Neither GOOGLE_SERVICE_ACCOUNT_KEY_JSON nor GOOGLE_SERVICE_ACCOUNT_KEY_PATH is set',
    );
  }

  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(raw) as ServiceAccountKey;
  } catch (e) {
    throw new IntegrationError(
      'google-auth',
      `Invalid service account JSON: ${(e as Error).message}`,
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new IntegrationError(
      'google-auth',
      'Service account JSON missing client_email or private_key',
    );
  }

  // Replace literal "\n" with real newlines (common when injected as env var).
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');

  parsedKeyCache = parsed;
  return parsed;
}

/**
 * Get a memoized JWT auth client for the given scopes. Multiple calls with
 * the same scope-set return the same instance.
 */
export function getServiceAccountAuth(scopes: string[]): JWT {
  const key = [...scopes].sort().join(' ');
  const cached = jwtCache.get(key);
  if (cached) return cached;

  const sa = parseKey();
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes,
  });
  jwtCache.set(key, jwt);
  return jwt;
}

/**
 * Test-only: clears the in-memory caches. Not exported from the package
 * barrel; tests import directly from `./google-auth/index`.
 */
export function _resetGoogleAuthCacheForTests(): void {
  parsedKeyCache = null;
  jwtCache.clear();
}
