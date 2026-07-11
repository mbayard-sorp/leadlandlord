import { describe, expect, it } from 'vitest';
import { signRecordingToken, verifyRecordingToken } from './tenant-recording-token';

const SECRET = 'test-secret-value';
const CALL_ID = '11111111-1111-1111-1111-111111111111';

describe('signRecordingToken / verifyRecordingToken', () => {
  it('round-trips a freshly signed token', () => {
    const token = signRecordingToken(CALL_ID, SECRET);
    expect(verifyRecordingToken(CALL_ID, token, SECRET)).toBe(true);
  });

  it('rejects a token for a different callId', () => {
    const token = signRecordingToken(CALL_ID, SECRET);
    expect(verifyRecordingToken('22222222-2222-2222-2222-222222222222', token, SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signRecordingToken(CALL_ID, SECRET);
    expect(verifyRecordingToken(CALL_ID, token, 'wrong-secret')).toBe(false);
  });

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signRecordingToken(CALL_ID, SECRET, -10); // already expired
    expect(verifyRecordingToken(CALL_ID, token, SECRET, now)).toBe(false);
  });

  it('accepts a token right up to its expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signRecordingToken(CALL_ID, SECRET, 60);
    expect(verifyRecordingToken(CALL_ID, token, SECRET, now + 59)).toBe(true);
  });

  it('rejects when secret is missing', () => {
    const token = signRecordingToken(CALL_ID, SECRET);
    expect(verifyRecordingToken(CALL_ID, token, undefined)).toBe(false);
  });

  it('rejects when token is missing', () => {
    expect(verifyRecordingToken(CALL_ID, null, SECRET)).toBe(false);
    expect(verifyRecordingToken(CALL_ID, undefined, SECRET)).toBe(false);
  });

  it('rejects a malformed token (no dot separator)', () => {
    expect(verifyRecordingToken(CALL_ID, 'not-a-valid-token', SECRET)).toBe(false);
  });

  it('rejects a token with a non-numeric expiry', () => {
    expect(verifyRecordingToken(CALL_ID, 'abc.deadbeef', SECRET)).toBe(false);
  });

  it('rejects a tampered signature of the same length', () => {
    const token = signRecordingToken(CALL_ID, SECRET);
    const [exp, sig] = token.split('.') as [string, string];
    const tamperedSig = sig.slice(0, -1) + (sig.at(-1) === '0' ? '1' : '0');
    expect(verifyRecordingToken(CALL_ID, `${exp}.${tamperedSig}`, SECRET)).toBe(false);
  });

  it('throws when signing with an empty secret', () => {
    expect(() => signRecordingToken(CALL_ID, '')).toThrow();
  });

  it('defaults to a ~7 day expiry', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signRecordingToken(CALL_ID, SECRET);
    const exp = Number.parseInt(token.split('.')[0] ?? '', 10);
    const sevenDays = 7 * 24 * 60 * 60;
    expect(exp).toBeGreaterThanOrEqual(before + sevenDays - 5);
    expect(exp).toBeLessThanOrEqual(before + sevenDays + 5);
  });
});
