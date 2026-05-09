/**
 * Zoho MCP sendEmail args.
 *
 * Shape mirrors the Resend wrapper's `SendEmailArgs` so callers can swap
 * providers without changing call-sites. Fields that Zoho does not natively
 * support (`tags`, `replyTo`) are accepted for signature parity but currently
 * IGNORED — the Zoho `ZohoMail_sendEmail` tool exposes no equivalent.
 */
export interface SendEmailArgs {
  to: string | string[];
  from: string;
  subject: string;
  /** Plain-text body. Either text or html (or both) is required. */
  text?: string;
  /** HTML body. Preferred when both text and html are supplied. */
  html?: string;
  /** Accepted for parity with the Resend wrapper. Currently ignored. */
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Accepted for parity with the Resend wrapper. Currently ignored. */
  tags?: Array<{ name: string; value: string }>;
}
