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

// ────────────────────────────────────────────────────────────
// Inbox-side types (R4.4)
// ────────────────────────────────────────────────────────────

export interface ListMessagesArgs {
  /** ISO timestamp lower bound. Defaults to 7 days ago. */
  since?: string;
  /** Zoho folder id. Falls back to `ZOHO_MOLLY_INBOX_FOLDER_ID` env. */
  folderId?: string;
  /** Max messages to return per call. Clamped to 1–200. Default 50. */
  limit?: number;
}

export interface ListedMessage {
  messageId: string;
  subject: string;
  fromAddress: string;
  /** ISO timestamp when Zoho received the message. */
  receivedAt: string | null;
  folderId: string | null;
  threadId: string | null;
}

export interface FetchedMessage {
  messageId: string;
  /** Raw In-Reply-To header value, angle-brackets stripped. Null when absent. */
  inReplyTo: string | null;
  /** References chain (older to newer), angle-brackets stripped. */
  references: string[];
  subject: string;
  fromAddress: string;
  receivedAt: string | null;
  /** Full message body as Zoho returns it (may include quoted parent). */
  body: string;
  /** Reply-only body when Zoho's `blockContent` extraction succeeded. */
  replyOnlyBody: string | null;
}

export interface SendReplyArgs {
  /** The Zoho `messageId` of the message we're replying to. */
  inReplyToMessageId: string;
  to: string | string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
}
