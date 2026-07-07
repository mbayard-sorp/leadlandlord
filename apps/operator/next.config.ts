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

// Relative to this app dir. Traces every agent prompt/overlay markdown file
// into the Lambda bundle so runtime readFileSync calls resolve in production.
const AGENT_PROMPT_GLOB = '../../packages/agents/src/**/*.md';

// The @leadlandlord/us-cities package reads its CSV + census JSON via
// readFileSync('../data/...') at runtime (see packages/us-cities/src/index.ts).
// nft doesn't trace these data files automatically, so any agent route that
// loads the city list (niche-scout) ENOENTs in production without this.
const US_CITIES_DATA_GLOB = '../../packages/us-cities/data/**';
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
  // Static text files (system.md prompts, niche overlays) are read by agents
  // at runtime via readFileSync and aren't traced automatically by Vercel's
  // nft. A single glob covers every current and future agent prompt so adding
  // a new agent can't silently ENOENT in production. Convention: all agent
  // prompt files live under packages/agents/src/.
  outputFileTracingIncludes: {
    '/api/operator/build': [AGENT_PROMPT_GLOB],
    // niche-scout runs via both the direct agent trigger and the operator-tick
    // fan-out, and reads the us-cities data files at runtime — trace them here.
    '/api/cron/agent/[name]': [AGENT_PROMPT_GLOB, US_CITIES_DATA_GLOB],
    '/api/cron/operator-tick': [AGENT_PROMPT_GLOB, US_CITIES_DATA_GLOB],
    // triggerOperatorTick server action is invoked from the prospects page
    // and ultimately loads the ContentEngine agent via runOperatorTick.
    '/operator/backlinks/prospects': [AGENT_PROMPT_GLOB],
    // The agents dashboard imports the agent registry, which loads each
    // agent's index.ts (system.md read at module init).
    '/operator/agents': [AGENT_PROMPT_GLOB],
    // The niches page's runNicheScout server action loads the us-cities data
    // files directly (not via the cron routes above) — trace them here too.
    '/operator/niches': [AGENT_PROMPT_GLOB, US_CITIES_DATA_GLOB],
  },
};

export default config;
