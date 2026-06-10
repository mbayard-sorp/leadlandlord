import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type {
  SendEmailArgs,
  ListMessagesArgs,
  ListedMessage,
  FetchedMessage,
  SendReplyArgs,
} from './types';

export type {
  SendEmailArgs,
  ListMessagesArgs,
  ListedMessage,
  FetchedMessage,
  SendReplyArgs,
} from './types';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const ZOHO_TOOL_SEND = 'ZohoMail_sendEmail';
const ZOHO_TOOL_SEND_REPLY = 'ZohoMail_sendReplyEmail';
const ZOHO_TOOL_SEARCH = 'ZohoMail_SearchEmails';
const ZOHO_TOOL_GET_HEADER = 'ZohoMail_getMessageHeader';
const ZOHO_TOOL_GET_CONTENT = 'ZohoMail_getMessageContent';
const ZOHO_TOOL_GET_DETAILS = 'ZohoMail_getMessageDetails';

function joinAddresses(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : value;
}

interface JsonRpcResult {
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Low-level call into the Zoho MCP server. Returns the parsed inner JSON
 * payload (the body of `result.content[0].text`). All Zoho MCP tools return
 * their actual response as a JSON string wrapped in MCP envelope, so callers
 * always have to unwrap twice.
 */
async function callTool<T>(toolName: string, args: unknown): Promise<T> {
  const url = process.env.ZOHO_MCP_URL;
  if (!url) {
    throw new IntegrationError('zoho-mcp', 'ZOHO_MCP_URL not set');
  }

  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(rpcBody),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'zoho-mcp',
      `${toolName} failed: ${res.status} ${text}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as {
    jsonrpc?: string;
    result?: JsonRpcResult;
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new IntegrationError(
      'zoho-mcp',
      `JSON-RPC error from ${toolName}: ${json.error.message}`,
      json.error.code,
      json.error,
    );
  }

  const result = json.result;
  if (!result || !Array.isArray(result.content) || result.content.length === 0) {
    throw new IntegrationError(
      'zoho-mcp',
      `${toolName}: malformed response (missing result.content)`,
      undefined,
      json,
    );
  }
  const innerText = result.content[0]?.text ?? '';
  if (result.isError) {
    throw new IntegrationError('zoho-mcp', `${toolName} tool error: ${innerText}`, undefined, innerText);
  }
  try {
    return JSON.parse(innerText) as T;
  } catch (err) {
    // Zoho occasionally returns a plaintext error (e.g. "You cannot access this
    // mailbox", rate-limit notices, expired-token messages) instead of JSON.
    // Surface the raw body in the message itself so the real signal isn't
    // hidden behind a generic parser error in agent_runs logs.
    const snippet = innerText.trim().slice(0, 300);
    const parserMsg = (err as Error).message;
    throw new IntegrationError(
      'zoho-mcp',
      `${toolName}: non-JSON response (${parserMsg}): ${snippet}`,
      undefined,
      innerText,
    );
  }
}

function requireAccountId(): string {
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!accountId) {
    throw new IntegrationError('zoho-mcp', 'ZOHO_ACCOUNT_ID not set');
  }
  return accountId;
}

/**
 * Send a transactional email via the Zoho MCP server.
 *
 * Drop-in replacement for the Resend wrapper's `sendEmail`. Routes through the
 * stateless Zoho MCP `ZohoMail_sendEmail` tool. Auth is via the credential
 * embedded in `ZOHO_MCP_URL` (no Authorization header).
 *
 * Note: `tags` and `replyTo` are accepted for signature parity but ignored —
 * the Zoho tool surface exposes no equivalent fields.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ messageId: string }> {
  const accountId = requireAccountId();

  if (!args.text && !args.html) {
    throw new IntegrationError('zoho-mcp', 'sendEmail requires text or html body');
  }

  const useHtml = Boolean(args.html);
  const content = useHtml ? args.html! : args.text!;
  const mailFormat: 'html' | 'plaintext' = useHtml ? 'html' : 'plaintext';

  const body: Record<string, unknown> = {
    fromAddress: args.from,
    toAddress: joinAddresses(args.to)!,
    subject: args.subject,
    content,
    mailFormat,
    askReceipt: 'no',
  };
  const cc = joinAddresses(args.cc);
  if (cc) body.ccAddress = cc;
  const bcc = joinAddresses(args.bcc);
  if (bcc) body.bccAddress = bcc;

  const inner = await callTool<{
    status?: { code?: number; description?: string };
    data?: { messageId?: string };
  }>(ZOHO_TOOL_SEND, { body, path_variables: { accountId } });

  const messageId = inner.data?.messageId;
  if (!messageId) {
    throw new IntegrationError(
      'zoho-mcp',
      `missing data.messageId in response (status: ${inner.status?.description ?? 'unknown'})`,
      inner.status?.code,
      inner,
    );
  }
  log.info({ messageId }, 'zoho-mcp email sent');
  return { messageId };
}

// ────────────────────────────────────────────────────────────
// Inbox-side wrappers (R4.4)
// ────────────────────────────────────────────────────────────

/**
 * Format a Date as Zoho's `DD-MMM-YYYY` (e.g. `12-MAY-2026`). Zoho's
 * SearchEmails `fromDate` / `toDate` use this format exclusively.
 */
function toZohoDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mmm = months[d.getUTCMonth()]!;
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mmm}-${yyyy}`;
}

/**
 * List messages received since `since` (default: 7 days ago). Optionally
 * scoped to a folder by `folderId` (env `ZOHO_MOLLY_INBOX_FOLDER_ID` or the
 * arg). Uses `ZohoMail_SearchEmails` because it supports a `fromDate` filter
 * — `listEmails` only sorts by date.
 *
 * Zoho `fromDate` granularity is one day, so we always pull at least one
 * full UTC day's traffic. The caller is responsible for de-duping against
 * its own high-water mark (we return server-supplied `receivedAt`).
 */
export async function listMessages(args: ListMessagesArgs = {}): Promise<ListedMessage[]> {
  const accountId = requireAccountId();
  const folderId = args.folderId ?? process.env.ZOHO_MOLLY_INBOX_FOLDER_ID;
  const sinceDate = args.since ? new Date(args.since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

  const parts: string[] = [`fromDate:${toZohoDate(sinceDate)}`];
  if (folderId) parts.push(`in:${folderId}`);
  const searchKey = parts.join('::');

  const inner = await callTool<{
    status?: { code?: number; description?: string };
    data?: Array<Record<string, unknown>>;
  }>(ZOHO_TOOL_SEARCH, {
    // SearchEmails takes its args as query_params, not body (schema changed
    // server-side 2026-06; body-shaped args fail with "Mandatory query param
    // searchKey is not present in tool body").
    query_params: {
      searchKey,
      start: 1,
      limit,
    },
    path_variables: { accountId },
  });

  const data = inner.data ?? [];
  const items: ListedMessage[] = [];
  for (const row of data) {
    const messageId = String(row.messageId ?? row.message_id ?? '');
    if (!messageId) continue;
    const subject = typeof row.subject === 'string' ? row.subject : '';
    const fromAddress = typeof row.fromAddress === 'string'
      ? row.fromAddress
      : typeof row.sender === 'string'
        ? row.sender
        : '';
    // Zoho returns `receivedTime` as a millisecond epoch string.
    const receivedMs = Number(row.receivedTime ?? row.sentDateInGMT ?? 0);
    const receivedAt = receivedMs > 0 ? new Date(receivedMs).toISOString() : null;
    items.push({
      messageId,
      subject,
      fromAddress,
      receivedAt,
      folderId: typeof row.folderId === 'string' ? row.folderId : null,
      threadId: typeof row.threadId === 'string' ? row.threadId : null,
    });
  }
  return items;
}

/**
 * Parse the `In-Reply-To` header value out of a raw header blob. Zoho's
 * `getMessageHeader` returns the headers as a single text blob; we look for
 * the `In-Reply-To:` line specifically.
 */
function parseInReplyTo(headerBlob: string): string | null {
  const match = /^In-Reply-To:\s*(.+)$/im.exec(headerBlob);
  if (!match) return null;
  return match[1]!.trim().replace(/^<|>$/g, '');
}

function parseReferences(headerBlob: string): string[] {
  const match = /^References:\s*(.+(?:\r?\n\s+.+)*)$/im.exec(headerBlob);
  if (!match) return [];
  return match[1]!
    .split(/\s+/)
    .map((s) => s.trim().replace(/^<|>$/g, ''))
    .filter(Boolean);
}

/**
 * Fetch a single inbox message, normalized for MollyInbox correlation.
 * Composes three Zoho calls:
 *   - getMessageDetails — metadata (subject, from, received)
 *   - getMessageHeader  — internet headers (In-Reply-To, References)
 *   - getMessageContent — body, optionally reply-only via includeBlockContent
 */
export async function getMessage(messageId: string): Promise<FetchedMessage> {
  const accountId = requireAccountId();

  const [details, header, content] = await Promise.all([
    callTool<{ data?: Record<string, unknown> }>(ZOHO_TOOL_GET_DETAILS, {
      path_variables: { accountId, messageId },
    }),
    callTool<{ data?: { headerContent?: string; header?: string } }>(ZOHO_TOOL_GET_HEADER, {
      path_variables: { accountId, messageId },
    }),
    callTool<{ data?: { content?: string; blockContent?: string } }>(ZOHO_TOOL_GET_CONTENT, {
      body: { includeBlockContent: true },
      path_variables: { accountId, messageId },
    }),
  ]);

  const headerBlob = String(header.data?.headerContent ?? header.data?.header ?? '');
  const inReplyTo = parseInReplyTo(headerBlob);
  const references = parseReferences(headerBlob);

  const d = details.data ?? {};
  const subject = typeof d.subject === 'string' ? d.subject : '';
  const fromAddress = typeof d.fromAddress === 'string' ? d.fromAddress : '';
  const receivedMs = Number(d.receivedTime ?? d.sentDateInGMT ?? 0);
  const receivedAt = receivedMs > 0 ? new Date(receivedMs).toISOString() : null;

  // Prefer the reply-only block when available — strips the quoted parent.
  const body = String(content.data?.content ?? '');
  const replyOnly = content.data?.blockContent;

  return {
    messageId,
    inReplyTo,
    references,
    subject,
    fromAddress,
    receivedAt,
    body,
    replyOnlyBody: typeof replyOnly === 'string' && replyOnly.length > 0 ? replyOnly : null,
  };
}

/**
 * Send a threaded reply to a previously-received message. Used by nudges so
 * they appear in the prospect's existing email thread rather than landing as
 * a brand-new conversation.
 */
export async function sendReply(args: SendReplyArgs): Promise<{ messageId: string }> {
  const accountId = requireAccountId();

  if (!args.text && !args.html) {
    throw new IntegrationError('zoho-mcp', 'sendReply requires text or html body');
  }
  const useHtml = Boolean(args.html);
  const content = useHtml ? args.html! : args.text!;
  const mailFormat: 'html' | 'plaintext' = useHtml ? 'html' : 'plaintext';

  const body: Record<string, unknown> = {
    action: 'reply',
    fromAddress: args.from,
    toAddress: joinAddresses(args.to)!,
    subject: args.subject,
    content,
    mailFormat,
    askReceipt: 'no',
  };
  const cc = joinAddresses(args.cc);
  if (cc) body.ccAddress = cc;
  const bcc = joinAddresses(args.bcc);
  if (bcc) body.bccAddress = bcc;

  const inner = await callTool<{
    status?: { code?: number; description?: string };
    data?: { messageId?: string };
  }>(ZOHO_TOOL_SEND_REPLY, {
    body,
    path_variables: { accountId, messageId: args.inReplyToMessageId },
  });

  const messageId = inner.data?.messageId;
  if (!messageId) {
    throw new IntegrationError(
      'zoho-mcp',
      `sendReply: missing data.messageId (status: ${inner.status?.description ?? 'unknown'})`,
      inner.status?.code,
      inner,
    );
  }
  log.info({ messageId, inReplyTo: args.inReplyToMessageId }, 'zoho-mcp reply sent');
  return { messageId };
}
