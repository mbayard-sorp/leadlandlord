import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { assertNotAuditing } from '../audit-guard';

const RESEND_BASE = 'https://api.resend.com';

const SendEmailResponseSchema = z.object({ id: z.string() });

export interface SendEmailArgs {
  to: string | string[];
  from: string;
  subject: string;
  /** Plain-text body. Either text or html (or both) is required. */
  text?: string;
  /** HTML body. */
  html?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  /** Optional metadata tags surfaced in the Resend dashboard. */
  tags?: Array<{ name: string; value: string }>;
}

/**
 * Send a transactional email via Resend.
 *
 * Resend docs: https://resend.com/docs/api-reference/emails/send-email
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ messageId: string }> {
  assertNotAuditing('resend.sendEmail');
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('resend', 'RESEND_API_KEY is required');
  }
  if (!args.text && !args.html) {
    throw new IntegrationError('resend', 'sendEmail requires text or html body');
  }
  const body = {
    from: args.from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
    text: args.text,
    html: args.html,
    reply_to: args.replyTo,
    cc: args.cc,
    bcc: args.bcc,
    tags: args.tags,
  };
  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'resend',
      `send failed: ${res.status} ${text}`,
      res.status,
      text,
    );
  }
  const json = SendEmailResponseSchema.parse(await res.json());
  log.info({ messageId: json.id }, 'resend email sent');
  return { messageId: json.id };
}
