import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, agentRuns } from '@leadlandlord/db';
import { eq, desc } from 'drizzle-orm';

async function main() {
  const db = getDb();
  const all = await db.select().from(agentRuns).where(eq(agentRuns.agent, 'domain-procurer')).orderBy(desc(agentRuns.startedAt));
  const registers = all.filter((r) => r.dedupeKey?.startsWith('register:'));
  console.log(`Register runs (${registers.length}):`);
  for (const r of registers) {
    console.log(`  ${r.id.slice(0,8)}  ${r.status.padEnd(10)} ${r.dedupeKey}  ${r.startedAt.toISOString()}`);
    console.log(`    output: ${JSON.stringify(r.output)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
