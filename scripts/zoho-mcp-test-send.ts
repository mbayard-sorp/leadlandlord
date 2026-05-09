#!/usr/bin/env -S tsx
/**
 * One-shot send test for the Zoho MCP integration.
 *
 * Sends a single email via ZohoMail_sendEmail to confirm the schema works
 * before we build the integration package. Use a recipient you control.
 *
 * Usage:
 *   tsx scripts/zoho-mcp-test-send.ts --to mike@example.com
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

const { values } = parseArgs({
  options: {
    to: { type: 'string' },
    subject: { type: 'string' },
  },
});

const MCP_URL = process.env.ZOHO_MCP_URL;
const ACCOUNT_ID = process.env.ZOHO_ACCOUNT_ID;
const FROM = process.env.ZOHO_DEFAULT_FROM ?? 'molly@leadslandlord.com';
const TO = values.to;
const SUBJECT = values.subject ?? 'LeadLandlord Zoho MCP smoke test';

if (!MCP_URL || !ACCOUNT_ID || !TO) {
  console.error('Need ZOHO_MCP_URL, ZOHO_ACCOUNT_ID, and --to flag');
  process.exit(1);
}

const body = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'ZohoMail_sendEmail',
    arguments: {
      body: {
        fromAddress: FROM,
        toAddress: TO,
        subject: SUBJECT,
        content:
          'Hi,\n\nThis is an automated smoke test from the LeadLandlord agent integration.\n\nIf you received this, the Zoho MCP send path works end-to-end.\n\n— Molly\n',
        mailFormat: 'plaintext',
      },
      path_variables: { accountId: ACCOUNT_ID },
    },
  },
});

async function main() {
const res = await fetch(MCP_URL, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
  },
  body,
});

const ct = res.headers.get('content-type') ?? '';
let payload: unknown;
if (ct.includes('text/event-stream')) {
  const text = await res.text();
  const dataLine = text.split(/\n/).find((l) => l.startsWith('data:'));
  payload = dataLine ? JSON.parse(dataLine.replace(/^data:\s*/, '')) : { raw: text };
} else {
  payload = await res.json();
}

console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(payload, null, 2));
process.exit(res.ok ? 0 : 1);
}
main();
