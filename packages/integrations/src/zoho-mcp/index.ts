import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import type { SendEmailArgs } from './types';

export type { SendEmailArgs } from './types';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const ZOHO_TOOL_NAME = 'ZohoMail_sendEmail';

function joinAddresses(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : value;
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
  const url = process.env.ZOHO_MCP_URL;
  if (!url) {
    throw new IntegrationError('zoho-mcp', 'ZOHO_MCP_URL not set');
  }
  const accountId = process.env.ZOHO_ACCOUNT_ID;
  if (!accountId) {
    throw new IntegrationError('zoho-mcp', 'ZOHO_ACCOUNT_ID not set');
  }

  if (!args.text && !args.html) {
    throw new IntegrationError('zoho-mcp', 'sendEmail requires text or html body');
  }

  // Prefer html when both supplied.
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

  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: ZOHO_TOOL_NAME,
      arguments: {
        body,
        path_variables: { accountId },
      },
    },
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
      `send failed: ${res.status} ${text}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as {
    jsonrpc?: string;
    id?: unknown;
    result?: {
      content?: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new IntegrationError(
      'zoho-mcp',
      `JSON-RPC error: ${json.error.message}`,
      json.error.code,
      json.error,
    );
  }

  const result = json.result;
  if (!result || !Array.isArray(result.content) || result.content.length === 0) {
    throw new IntegrationError(
      'zoho-mcp',
      'malformed response: missing result.content',
      undefined,
      json,
    );
  }

  const innerText = result.content[0]?.text ?? '';

  if (result.isError) {
    throw new IntegrationError(
      'zoho-mcp',
      `tool error: ${innerText}`,
      undefined,
      innerText,
    );
  }

  let inner: { status?: { code?: number; description?: string }; data?: { messageId?: string } };
  try {
    inner = JSON.parse(innerText);
  } catch (err) {
    throw new IntegrationError(
      'zoho-mcp',
      `failed to parse inner response: ${(err as Error).message}`,
      undefined,
      innerText,
    );
  }

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
