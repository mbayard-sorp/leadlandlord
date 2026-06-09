import nodemailer from 'nodemailer';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { assertNotAuditing } from '../audit-guard';

export interface SendEmailArgs {
  to: string | string[];
  /** Sender. Must be the Zoho account address (or a verified alias on it). */
  from: string;
  subject: string;
  /** Plain-text body. Either text or html (or both) is required. */
  text?: string;
  /** HTML body. */
  html?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

/**
 * Send a transactional email via Zoho Mail SMTP (nodemailer).
 *
 * Env:
 * - ZOHO_SMTP_HOST — e.g. smtp.zoho.com
 * - ZOHO_SMTP_PORT — 465 (SSL) or 587 (STARTTLS)
 * - ZOHO_SMTP_USER — the Zoho email address
 * - ZOHO_SMTP_PASS — the Zoho app password
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ messageId: string }> {
  assertNotAuditing('zoho-smtp.sendEmail');
  const host = process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com';
  const port = Number(process.env.ZOHO_SMTP_PORT || 465);
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASS;
  if (!user || !pass) {
    throw new IntegrationError('zoho-smtp', 'ZOHO_SMTP_USER and ZOHO_SMTP_PASS are required');
  }
  if (!args.text && !args.html) {
    throw new IntegrationError('zoho-smtp', 'sendEmail requires text or html body');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      replyTo: args.replyTo,
      cc: args.cc,
      bcc: args.bcc,
    });
    log.info({ messageId: info.messageId }, 'zoho-smtp email sent');
    return { messageId: info.messageId };
  } catch (err) {
    throw new IntegrationError(
      'zoho-smtp',
      `send failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
