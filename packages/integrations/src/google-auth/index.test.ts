import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getServiceAccountAuth, _resetGoogleAuthCacheForTests } from './index';

const FAKE_KEY = {
  client_email: 'sa@test.iam.gserviceaccount.com',
  private_key:
    '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n',
  type: 'service_account',
};

describe('getServiceAccountAuth', () => {
  const origJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  const origPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  beforeEach(() => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    _resetGoogleAuthCacheForTests();
  });

  afterEach(() => {
    if (origJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = origJson;
    if (origPath === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    else process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = origPath;
  });

  it('throws when no env var is set', () => {
    expect(() => getServiceAccountAuth(['s1'])).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY/);
  });

  it('parses raw JSON in GOOGLE_SERVICE_ACCOUNT_KEY_JSON', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify(FAKE_KEY);
    const jwt = getServiceAccountAuth(['scope-a']);
    expect(jwt.email).toBe(FAKE_KEY.client_email);
    // Literal \n should have been converted to real newlines
    expect(jwt.key).toContain('\n');
    expect(jwt.key).not.toContain('\\n');
  });

  it('parses base64-encoded JSON', () => {
    const b64 = Buffer.from(JSON.stringify(FAKE_KEY), 'utf-8').toString('base64');
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = b64;
    const jwt = getServiceAccountAuth(['scope-a']);
    expect(jwt.email).toBe(FAKE_KEY.client_email);
  });

  it('memoizes JWT instances per scope-set (order-insensitive)', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify(FAKE_KEY);
    const a = getServiceAccountAuth(['s1', 's2']);
    const b = getServiceAccountAuth(['s2', 's1']);
    const c = getServiceAccountAuth(['s3']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('throws on invalid JSON', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = '{not-json';
    expect(() => getServiceAccountAuth(['s1'])).toThrow(/Invalid service account JSON|base64/);
  });
});
