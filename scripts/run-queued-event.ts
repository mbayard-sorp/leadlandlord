#!/usr/bin/env -S tsx
/**
 * One-off: dispatch a single queued agent_event directly against PRODUCTION,
 * bypassing the operator-tick queue drain (used when the prod dispatcher is
 * wedged). Runs the exact same getAgent(target).run(payload) the drain does,
 * then marks the event processed so the cron won't re-run it once it recovers.
 *
 * Usage: pnpm tsx scripts/run-queued-event.ts [event-type]   (default niche.scout)
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// eslint-disable-next-line import/order
import { and, asc, eq, isNull } from 'drizzle-orm';
// eslint-disable-next-line import/order
import { getDb, agentEvents } from '@leadlandlord/db';
import { markEventProcessed } from '@leadlandlord/db/queue';
import { getAgent } from '@leadlandlord/agents/registry';
import { log } from '@leadlandlord/shared/log';

async function main() {
  const type = process.argv[2] ?? 'niche.scout';
  if ((process.env.SANITY_DATASET ?? 'production') !== 'production') {
    console.error(`Refusing: SANITY_DATASET is "${process.env.SANITY_DATASET}", expected production.`);
    process.exit(1);
  }
  const db = getDb();
  const [ev] = await db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.type, type), isNull(agentEvents.processedAt), isNull(agentEvents.deadLetteredAt)))
    .orderBy(asc(agentEvents.createdAt))
    .limit(1);
  if (!ev) {
    console.log(`No pending '${type}' event.`);
    return;
  }
  const target = (ev.targetAgent ?? ev.agent) as string;
  const payload = ev.payload as Record<string, unknown>;
  const siteId = typeof payload?.site_id === 'string' ? payload.site_id : undefined;
  console.log('─'.repeat(64));
  console.log(`  dispatching event ${ev.id}`);
  console.log(`  type=${ev.type} target=${target}`);
  console.log(`  payload=${JSON.stringify(payload)}`);
  console.log('─'.repeat(64));
  const t0 = Date.now();
  const out = await getAgent(target).run(payload, { eventId: ev.id, siteId });
  await markEventProcessed(ev.id);
  console.log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(out, null, 2).slice(0, 1200));
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err, stack: err instanceof Error ? err.stack : undefined }, 'run-queued-event failed');
  process.exit(1);
});
