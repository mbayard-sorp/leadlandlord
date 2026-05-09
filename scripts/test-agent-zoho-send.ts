#!/usr/bin/env -S tsx
/**
 * Phase 6 smoke test — exercises the full agent → throttle → zoho-mcp path.
 *
 * Picks an existing site from the DB, invokes backlink-builder in guest_post
 * mode with a recipient you control, and reports the resulting backlinks +
 * email_sends rows. Bypasses HARO/citations modes; targets only the new
 * email-send code path.
 *
 * Requires: ZOHO_MCP_ENABLED=true, ZOHO_MCP_URL, ZOHO_ACCOUNT_ID,
 * ZOHO_DEFAULT_FROM, LEADLANDLORD_POSTAL_ADDRESS, ANTHROPIC_API_KEY,
 * DATABASE_URL all set in .env.local. Compliance gate may reject the draft;
 * that's a valid outcome — re-run if so.
 *
 * Usage:
 *   tsx scripts/test-agent-zoho-send.ts --to mike@example.com
 *   tsx scripts/test-agent-zoho-send.ts --to mike@example.com --site-id <uuid>
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
    'site-id': { type: 'string' },
    domain: { type: 'string' },
    topic: { type: 'string' },
  },
});

if (!values.to) {
  console.error('--to <email> required');
  process.exit(1);
}

// Force the Zoho path for this smoke test regardless of the .env.local default.
process.env.ZOHO_MCP_ENABLED = 'true';

// eslint-disable-next-line import/order
import { sql } from 'drizzle-orm';
import { getDb, sites, backlinks, emailSends } from '@leadlandlord/db';
import { BacklinkBuilder } from '@leadlandlord/agents/backlink-builder';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const db = getDb();
  let site;
  if (values['site-id']) {
    site = (await db.select().from(sites).where(eq(sites.id, values['site-id']!)).limit(1))[0];
  } else {
    site = (await db.select().from(sites).orderBy(desc(sites.createdAt)).limit(1))[0];
  }
  if (!site) {
    console.error('no sites in DB; pass --site-id or seed one first');
    process.exit(2);
  }

  console.log(`using site ${site.id} — ${site.niche} in ${site.city}, ${site.state}`);

  const targetDomain = values.domain ?? `smoketest-${Date.now()}.example.com`;
  const pitchTopic = values.topic ?? `Local ${site.niche} insights for your readers`;

  const agent = new BacklinkBuilder();
  const result = await agent.run(
    {
      mode: 'guest_post',
      siteId: site.id,
      targetDomain,
      targetEditorEmail: values.to!,
      pitchTopic,
    },
    { eventId: crypto.randomUUID() },
  );

  console.log('agent result:', JSON.stringify(result, null, 2));

  // Show the resulting rows.
  const sends = await db
    .select()
    .from(emailSends)
    .orderBy(desc(emailSends.sentAt))
    .limit(3);
  console.log('\nrecent email_sends rows:');
  for (const s of sends) {
    console.log(`  ${s.sentAt.toISOString()} ${s.status.padEnd(10)} ${s.provider.padEnd(7)} → ${s.toAddress}  (id: ${s.externalId ?? '-'})`);
  }

  const links = await db
    .select()
    .from(backlinks)
    .where(eq(backlinks.siteId, site.id))
    .orderBy(desc(backlinks.createdAt))
    .limit(3);
  console.log('\nrecent backlinks rows for this site:');
  for (const b of links) {
    console.log(`  ${b.createdAt.toISOString()} ${b.status.padEnd(10)} ${b.type.padEnd(12)} ${b.sourceDomain}`);
  }
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
