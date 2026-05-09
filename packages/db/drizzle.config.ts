import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Walk up from this config file looking for .env.local — handles git worktrees
// where the repo root is not just two directories up from packages/db.
function findUp(start: string, name: string): string | undefined {
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

const envLocal = findUp(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });
const envFallback = findUp(__dirname, '.env');
if (envFallback) loadEnv({ path: envFallback, override: false });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for drizzle-kit. Set it in .env.local at the repo root.');
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
