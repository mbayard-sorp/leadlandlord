import { describe, it, expect, afterEach } from 'vitest';
import { assertNotAuditing } from './audit-guard';
import { sendEmail } from './resend/index';

const ORIGINAL = process.env.AGENT_AUDIT;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENT_AUDIT;
  else process.env.AGENT_AUDIT = ORIGINAL;
});

describe('assertNotAuditing', () => {
  it('throws when AGENT_AUDIT=1', () => {
    process.env.AGENT_AUDIT = '1';
    expect(() => assertNotAuditing('test.action')).toThrow(/AGENT_AUDIT=1/);
  });

  it('is a no-op when AGENT_AUDIT is unset', () => {
    delete process.env.AGENT_AUDIT;
    expect(() => assertNotAuditing('test.action')).not.toThrow();
  });

  it('is a no-op for any value other than "1"', () => {
    process.env.AGENT_AUDIT = 'true';
    expect(() => assertNotAuditing('test.action')).not.toThrow();
  });
});

describe('outbound integrations refuse to fire under AGENT_AUDIT=1', () => {
  it('sendEmail throws before touching the network or reading creds', async () => {
    process.env.AGENT_AUDIT = '1';
    await expect(
      sendEmail({ to: 'a@b.com', from: 'x@leadslandlord.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/AGENT_AUDIT=1/);
  });
});
