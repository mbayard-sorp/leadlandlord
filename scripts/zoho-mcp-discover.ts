#!/usr/bin/env -S tsx
/**
 * Zoho MCP — Phase 1 discovery script.
 *
 * Probes the Zoho MCP endpoint to confirm:
 *   1. Transport (Streamable HTTP vs HTTP+SSE)
 *   2. Whether `initialize` handshake is required, or one-shot tools/list works
 *   3. The exact `sendEmail` tool name + inputSchema (Zoho may rename camelCase
 *      args from the REST API)
 *
 * Reads ZOHO_MCP_URL from .env.local. Writes a markdown report to
 * .planning/zoho-mcp-integration/TOOLS.md.
 *
 * Usage:
 *   tsx scripts/zoho-mcp-discover.ts
 *   tsx scripts/zoho-mcp-discover.ts --tool sendEmail   # also dump full schema for one tool
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
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
    tool: { type: 'string' },
    verbose: { type: 'boolean', short: 'v' },
  },
});
const verbose = !!values.verbose;
const targetTool = values.tool;

const MCP_URL = process.env.ZOHO_MCP_URL;
if (!MCP_URL) {
  console.error('ZOHO_MCP_URL not set in .env.local');
  process.exit(1);
}

const PROTOCOL_VERSION = '2025-11-25';
let sessionId: string | undefined;

async function rpc(method: string, params?: unknown, id: number | string = Math.floor(Math.random() * 1e9)) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  if (verbose) console.log('→', method, params ? JSON.stringify(params).slice(0, 200) : '');

  const res = await fetch(MCP_URL!, { method: 'POST', headers, body });
  const captured = res.headers.get('mcp-session-id');
  if (captured && !sessionId) sessionId = captured;

  const ct = res.headers.get('content-type') ?? '';
  let payload: unknown;
  if (ct.includes('text/event-stream')) {
    // Server returned SSE; parse the first JSON-RPC frame.
    const text = await res.text();
    const dataLine = text.split(/\n/).find((l) => l.startsWith('data:'));
    if (!dataLine) throw new Error(`SSE response had no data frame:\n${text}`);
    payload = JSON.parse(dataLine.replace(/^data:\s*/, ''));
  } else {
    const text = await res.text();
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (status ${res.status}):\n${text.slice(0, 500)}`);
    }
  }

  if (verbose) console.log('←', JSON.stringify(payload).slice(0, 400));

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(payload)}`);
  }
  const obj = payload as { error?: { code: number; message: string }; result?: unknown };
  if (obj.error) {
    throw new Error(`JSON-RPC error ${obj.error.code}: ${obj.error.message}`);
  }
  return obj.result;
}

async function notify(method: string, params?: unknown) {
  // Notifications: no id, no response expected. We still POST and ignore body.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await fetch(MCP_URL!, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
  });
}

async function main() {
  const host = new URL(MCP_URL!).host;
  console.log(`Probing Zoho MCP at ${host} ...`);

  // Step 1: try one-shot tools/list (no init).
  let tools: Array<{ name: string; description?: string; inputSchema?: unknown }> | undefined;
  try {
    const r = await rpc('tools/list');
    tools = (r as { tools: typeof tools }).tools;
    console.log('✓ One-shot tools/list worked (no initialize handshake required)');
  } catch (err) {
    console.log(`one-shot failed (${(err as Error).message}); trying initialize handshake...`);
    // Step 2: full lifecycle.
    const init = await rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'leadlandlord-discovery', version: '0.1.0' },
    });
    console.log('✓ initialize OK', JSON.stringify(init).slice(0, 200));
    if (sessionId) console.log(`  session id: ${sessionId}`);
    await notify('notifications/initialized');
    const r = await rpc('tools/list');
    tools = (r as { tools: typeof tools }).tools;
    console.log('✓ tools/list after handshake');
  }

  if (!tools) throw new Error('no tools returned');

  // Find sendEmail.
  const sendTool = tools.find((t) => t.name === 'ZohoMail_sendEmail' || t.name === 'sendEmail');
  if (!sendTool) {
    console.warn('⚠️  no tool named sendEmail; tools available:');
    for (const t of tools) console.warn(`  - ${t.name}`);
    process.exit(2);
  }

  // Optional dump for a different tool.
  let extraTool: typeof sendTool | undefined;
  if (targetTool && targetTool !== 'sendEmail') {
    extraTool = tools.find((t) => t.name === targetTool);
  }

  // Write report.
  const reportDir = resolve(__dirname, '..', '.planning', 'zoho-mcp-integration');
  mkdirSync(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, 'TOOLS.md');
  const lines: string[] = [];
  lines.push('# Zoho MCP — Discovered Tool Surface');
  lines.push('');
  lines.push(`Probed: ${new Date().toISOString()}`);
  lines.push(`Host: ${host}`);
  lines.push(`Required handshake: ${sessionId ? 'YES (initialize → notifications/initialized → tools/call)' : 'NO (one-shot calls accepted)'}`);
  if (sessionId) lines.push(`Session header: \`mcp-session-id\``);
  lines.push('');
  lines.push(`Total tools exposed: ${tools.length}`);
  lines.push('');
  lines.push('## sendEmail');
  lines.push('');
  if (sendTool.description) {
    lines.push(`**Description:** ${sendTool.description}`);
    lines.push('');
  }
  lines.push('**Input schema:**');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(sendTool.inputSchema, null, 2));
  lines.push('```');
  lines.push('');
  if (extraTool) {
    lines.push(`## ${extraTool.name}`);
    lines.push('');
    if (extraTool.description) lines.push(`**Description:** ${extraTool.description}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(extraTool.inputSchema, null, 2));
    lines.push('```');
    lines.push('');
  }
  lines.push('## All tools');
  lines.push('');
  for (const t of tools) {
    lines.push(`- \`${t.name}\` — ${t.description ?? '(no description)'}`);
  }
  lines.push('');
  writeFileSync(reportPath, lines.join('\n'));

  console.log(`\nWrote ${reportPath}`);
  console.log('\nsendEmail input schema:');
  console.log(JSON.stringify(sendTool.inputSchema, null, 2));
}

main().catch((err) => {
  console.error('discovery failed:', err);
  process.exit(1);
});
