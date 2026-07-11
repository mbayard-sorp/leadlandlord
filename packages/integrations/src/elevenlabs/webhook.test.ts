import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderQuestionScript, verifyElevenLabsWebhook } from './index';

const SECRET = 'test-secret-value';

function sign(timestampS: number, rawBody: string, secret = SECRET): string {
  const hex = createHmac('sha256', secret).update(`${timestampS}.${rawBody}`, 'utf-8').digest('hex');
  return `t=${timestampS},v0=${hex}`;
}

describe('verifyElevenLabsWebhook', () => {
  it('accepts a validly-signed, fresh payload', () => {
    const rawBody = JSON.stringify({ conversation_id: 'conv_123', event: 'post_call' });
    const nowMs = 1_700_000_000_000;
    const timestampS = Math.floor(nowMs / 1000);
    const signatureHeader = sign(timestampS, rawBody);

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(true);
  });

  it('rejects when the secret does not match', () => {
    const rawBody = JSON.stringify({ conversation_id: 'conv_123' });
    const nowMs = 1_700_000_000_000;
    const timestampS = Math.floor(nowMs / 1000);
    const signatureHeader = sign(timestampS, rawBody, 'wrong-secret');

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(false);
  });

  it('rejects when the body has been tampered with', () => {
    const rawBody = JSON.stringify({ conversation_id: 'conv_123' });
    const nowMs = 1_700_000_000_000;
    const timestampS = Math.floor(nowMs / 1000);
    const signatureHeader = sign(timestampS, rawBody);
    const tamperedBody = JSON.stringify({ conversation_id: 'conv_456' });

    expect(
      verifyElevenLabsWebhook({ rawBody: tamperedBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(
      verifyElevenLabsWebhook({ rawBody: '{}', signatureHeader: null, secret: SECRET }),
    ).toBe(false);
  });

  it('rejects a malformed header (missing t= or v0=)', () => {
    const rawBody = '{}';
    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader: 'garbage', secret: SECRET }),
    ).toBe(false);
    expect(
      verifyElevenLabsWebhook({
        rawBody,
        signatureHeader: 'v0=abcd1234',
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyElevenLabsWebhook({
        rawBody,
        signatureHeader: 't=1700000000',
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a timestamp older than 30 minutes', () => {
    const rawBody = '{}';
    const nowMs = 1_700_000_000_000;
    const staleTimestampS = Math.floor(nowMs / 1000) - 31 * 60;
    const signatureHeader = sign(staleTimestampS, rawBody);

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(false);
  });

  it('accepts a timestamp right at the 30 minute boundary', () => {
    const rawBody = '{}';
    const nowMs = 1_700_000_000_000;
    const timestampS = Math.floor(nowMs / 1000) - 30 * 60;
    const signatureHeader = sign(timestampS, rawBody);

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(true);
  });

  it('rejects a timestamp in the future beyond the window', () => {
    const rawBody = '{}';
    const nowMs = 1_700_000_000_000;
    const futureTimestampS = Math.floor(nowMs / 1000) + 31 * 60;
    const signatureHeader = sign(futureTimestampS, rawBody);

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: SECRET, nowMs }),
    ).toBe(false);
  });

  it('returns false when no secret is configured', () => {
    const rawBody = '{}';
    const timestampS = 1_700_000_000;
    const signatureHeader = sign(timestampS, rawBody);

    expect(
      verifyElevenLabsWebhook({ rawBody, signatureHeader, secret: undefined, nowMs: 1_700_000_000_000 }),
    ).toBe(false);
  });
});

describe('renderQuestionScript', () => {
  it('renders a flat numbered list', () => {
    const script = renderQuestionScript([
      'What is your name?',
      'What is the job address?',
      'Is this an emergency?',
    ]);
    expect(script).toBe(
      '1. What is your name?\n2. What is the job address?\n3. Is this an emergency?',
    );
  });

  it('handles a single question', () => {
    expect(renderQuestionScript(['Only question?'])).toBe('1. Only question?');
  });

  it('handles an empty list', () => {
    expect(renderQuestionScript([])).toBe('');
  });
});
