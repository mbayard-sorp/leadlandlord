import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Load secrets from the workspace-root .env.local. Walk up looking for it so
// this works inside git worktrees too (where the worktree root has no
// .env.local but the main checkout does).
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
const repoRoot = resolve(__dirname, '../..');
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

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
    '@leadlandlord/sanity-schema',
    '@leadlandlord/shared',
  ],
  serverExternalPackages: ['pino', '@neondatabase/serverless', '@sanity/client'],
  // Static text files read by agents at runtime (e.g. ContentEngine's
  // system.md) aren't traced automatically by Vercel's nft. Include them
  // explicitly for any route that may invoke an agent.
  outputFileTracingIncludes: {
    '/api/operator/build': [
      '../../packages/agents/src/content-engine/system.md',
    ],
    '/api/cron/agent/[name]': [
      '../../packages/agents/src/content-engine/system.md',
    ],
  },
};

export default config;
