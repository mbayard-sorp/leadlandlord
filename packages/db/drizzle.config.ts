import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load the repo-root .env.local first (where the user keeps secrets), falling back to .env.
const repoRoot = resolve(__dirname, '../..');
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });
loadEnv({ path: resolve(repoRoot, '.env'), override: true });

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
