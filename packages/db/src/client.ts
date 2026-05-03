import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(databaseUrl?: string) {
  if (cached) return cached;
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local at the repo root.');
  }
  const sql = neon(url);
  cached = drizzle(sql, { schema });
  return cached;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
