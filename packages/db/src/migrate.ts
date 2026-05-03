import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const migrationsFolder = resolve(__dirname, '../migrations');

  const sql = neon(url);
  const db = drizzle(sql);
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
