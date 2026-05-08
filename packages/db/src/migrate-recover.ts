/**
 * Recovery migrator. Use when `pnpm db:migrate` fails with "X already exists"
 * — typically after a prior agent partially applied a migration whose hash
 * later changed, leaving the journal out of sync with the actual schema.
 *
 * For each pending migration:
 *  - Try to apply it statement-by-statement.
 *  - If a statement fails with code 42701 (column collision), 42P07 (table
 *    collision), or 42710 (object collision — index/enum), treat it as
 *    "already applied" for that statement and continue.
 *  - Any other error halts the recovery (real failure).
 *  - At the end, record the migration's hash in __drizzle_migrations so
 *    drizzle's regular migrator skips it on the next run.
 *
 * Usage: `pnpm --filter @leadlandlord/db migrate-recover`
 *
 * Idempotent. Safe to re-run.
 */
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql as drizzleSql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const __initFilename = fileURLToPath(import.meta.url);
const __initDirname = dirname(__initFilename);
const __repoRoot = resolve(__initDirname, '../../..');
loadEnv({ path: resolve(__repoRoot, '.env.local'), override: true });
loadEnv({ path: resolve(__repoRoot, '.env'), override: true });

const COLLISION_CODES = new Set(['42701', '42P07', '42710', '42P16']);
// 42701 = column already exists
// 42P07 = relation already exists (table/index)
// 42710 = duplicate object (constraint, type, etc.)
// 42P16 = invalid table definition (sometimes for redundant FK)

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const migrationsFolder = resolve(__initDirname, '../migrations');
  const journal: { entries: JournalEntry[] } = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  );

  const client = neon(url);
  const db = drizzle(client);

  // Drizzle's migrator creates this on first successful run; mirror its DDL
  // so recover can run before any successful drizzle migrate.
  await db.execute(drizzleSql.raw(`CREATE SCHEMA IF NOT EXISTS drizzle`));
  await db.execute(
    drizzleSql.raw(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )
    `),
  );

  const appliedRows = (await db.execute(
    drizzleSql.raw(`SELECT hash FROM drizzle.__drizzle_migrations`),
  )) as { rows?: Array<{ hash: string }> } | Array<{ hash: string }>;
  const appliedRowsArr = Array.isArray(appliedRows)
    ? appliedRows
    : (appliedRows.rows ?? []);
  const appliedHashes = new Set(appliedRowsArr.map((r) => r.hash));

  for (const entry of journal.entries) {
    const sqlPath = join(migrationsFolder, entry.tag + '.sql');
    const content = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(content).digest('hex');

    if (appliedHashes.has(hash)) {
      console.log(`SKIP    ${entry.tag} (hash already in __drizzle_migrations)`);
      continue;
    }

    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let collisionCount = 0;
    let appliedCount = 0;

    for (const stmt of statements) {
      try {
        await db.execute(drizzleSql.raw(stmt));
        appliedCount++;
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code && COLLISION_CODES.has(code)) {
          collisionCount++;
          continue;
        }
        console.error(`FAIL    ${entry.tag}: ${(err as Error).message}`);
        throw err;
      }
    }

    // Record applied. Use parameter binding via drizzle.
    await db.execute(
      drizzleSql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`,
    );

    const tag = collisionCount > 0 ? 'RECOVER' : 'APPLY  ';
    console.log(
      `${tag} ${entry.tag} (applied=${appliedCount}, collisions=${collisionCount})`,
    );
  }

  console.log('Recovery migrate complete. Future `pnpm db:migrate` runs will be clean.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
