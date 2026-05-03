import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Load secrets from the workspace-root .env.local (Next.js only auto-loads
// from the app dir, but secrets live at the repo root for the whole monorepo).
const repoRoot = resolve(__dirname, '../..');
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });
loadEnv({ path: resolve(repoRoot, '.env'), override: true });

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
  // Workspace packages are imported as source — Next.js needs to know to transpile them.
  transpilePackages: [
    '@leadlandlord/agents',
    '@leadlandlord/db',
    '@leadlandlord/integrations',
    '@leadlandlord/shared',
  ],
  serverExternalPackages: ['pino', '@neondatabase/serverless'],
};

export default config;
