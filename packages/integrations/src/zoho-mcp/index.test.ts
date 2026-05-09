import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendEmail } from './index';

const ORIGINAL_ENV = { ...process.env };

function makeSuccessResponse(messageId = '1771234567890123456') {
  const innerText = JSON.stringify({
    status: { code: 200, description: 'success' },
    data: { messageId, subject: 'Test', fromAddress: 'molly@leadslandlord.com' },
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: innerText }],
        isError: false,
      },
    }),
    text: async () => '',
  };
}

type FetchArgs = [string, RequestInit];
function makeFetchMock(response: unknown) {
  return vi.fn(async (..._args: FetchArgs) => response as Response);
}

describe('zoho-mcp sendEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.ZOHO_MCP_URL = 'https://mcp.example.com/abc123';
    process.env.ZOHO_ACCOUNT_ID = 'acct_test_123';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('happy path: returns nested data.messageId from stringified result.content[0].text', async () => {
    const fetchMock = makeFetchMock(makeSuccessResponse('msg-happy-123'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      to: 'recipient@example.com',
      from: 'molly@leadslandlord.com',
      subject: 'Hello',
      text: 'Hi there',
    });

    expect(result).toEqual({ messageId: 'msg-happy-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('https://mcp.example.com/abc123');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['accept']).toBe('application/json, text/event-stream');
    expect(headers['mcp-protocol-version']).toBe('2025-11-25');
    const parsed = JSON.parse(calledInit.body as string);
    expect(parsed.method).toBe('tools/call');
    expect(parsed.params.name).toBe('ZohoMail_sendEmail');
    expect(parsed.params.arguments.path_variables.accountId).toBe('acct_test_123');
  });

  it('throws when ZOHO_MCP_URL is unset', async () => {
    delete process.env.ZOHO_MCP_URL;
    vi.stubGlobal('fetch', makeFetchMock(makeSuccessResponse()));

    await expect(
      sendEmail({
        to: 'r@example.com',
        from: 'm@leadslandlord.com',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/ZOHO_MCP_URL not set/);
  });

  it('throws when ZOHO_ACCOUNT_ID is unset', async () => {
    delete process.env.ZOHO_ACCOUNT_ID;
    vi.stubGlobal('fetch', makeFetchMock(makeSuccessResponse()));

    await expect(
      sendEmail({
        to: 'r@example.com',
        from: 'm@leadslandlord.com',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/ZOHO_ACCOUNT_ID not set/);
  });

  it('throws IntegrationError on tool error (result.isError === true)', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchMock({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: 'invalid recipient address' }],
            isError: true,
          },
        }),
        text: async () => '',
      }),
    );

    await expect(
      sendEmail({
        to: 'bad',
        from: 'm@leadslandlord.com',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/invalid recipient address/);
  });

  it('throws IntegrationError on JSON-RPC top-level error', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetchMock({
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        }),
        text: async () => '',
      }),
    );

    await expect(
      sendEmail({
        to: 'r@example.com',
        from: 'm@leadslandlord.com',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/Method not found/);
  });

  it('selects mailFormat=plaintext when only text supplied', async () => {
    const fetchMock = makeFetchMock(makeSuccessResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail({
      to: 'r@example.com',
      from: 'm@leadslandlord.com',
      subject: 's',
      text: 'plain body',
    });

    const parsed = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(parsed.params.arguments.body.mailFormat).toBe('plaintext');
    expect(parsed.params.arguments.body.content).toBe('plain body');
  });

  it('selects mailFormat=html when html supplied (preferred over text)', async () => {
    const fetchMock = makeFetchMock(makeSuccessResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail({
      to: 'r@example.com',
      from: 'm@leadslandlord.com',
      subject: 's',
      text: 'plain',
      html: '<p>rich</p>',
    });

    const parsed = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(parsed.params.arguments.body.mailFormat).toBe('html');
    expect(parsed.params.arguments.body.content).toBe('<p>rich</p>');
  });

  it('joins cc array as comma-separated ccAddress', async () => {
    const fetchMock = makeFetchMock(makeSuccessResponse());
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail({
      to: ['a@example.com', 'b@example.com'],
      from: 'm@leadslandlord.com',
      subject: 's',
      text: 't',
      cc: ['cc1@example.com', 'cc2@example.com'],
      bcc: 'bcc@example.com',
    });

    const parsed = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(parsed.params.arguments.body.toAddress).toBe('a@example.com,b@example.com');
    expect(parsed.params.arguments.body.ccAddress).toBe('cc1@example.com,cc2@example.com');
    expect(parsed.params.arguments.body.bccAddress).toBe('bcc@example.com');
  });
});
