#!/usr/bin/env -S tsx
/**
 * Seed the four theme docs into a Sanity dataset with deterministic IDs.
 *
 * Idempotent — re-running overwrites in place via createOrReplace.
 *
 * Usage:
 *   pnpm tsx scripts/seed-sanity-themes.ts                  # seeds production
 *   pnpm tsx scripts/seed-sanity-themes.ts --dataset development
 *   pnpm tsx scripts/seed-sanity-themes.ts --dataset all    # both datasets
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up from this file looking for .env.local — works inside git worktrees
// where the worktree root has no .env.local but the main checkout does.
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
const envFile = findEnvFile(__dirname, '.env');
if (envFile) loadEnv({ path: envFile, override: true });

import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import { themeDocId, THEME_NAMES, type ThemeName } from '@leadlandlord/sanity-schema/ids';

interface ThemeSeed {
  name: ThemeName;
  displayName: string;
  description: string;
}

const SEEDS: ThemeSeed[] = [
  {
    name: 'classic',
    displayName: 'Classic',
    description:
      'Tradesman, established. Navy + brick red, slab serifs, "call now" CTAs. Tree, plumbing, HVAC, electrical, roofing.',
  },
  {
    name: 'modern',
    displayName: 'Modern',
    description:
      'Clean, contemporary. Slate + sky blue, sans-serif, prominent forms. Junk removal, moving, cleaning, pest control.',
  },
  {
    name: 'premium',
    displayName: 'Premium',
    description:
      'Curated, luxury. Charcoal + gold, serif headlines, magazine layout. High-end remodels, estate care, concierge.',
  },
  {
    name: 'bright',
    displayName: 'Bright',
    description:
      'Warm, friendly, "book online". Cream + coral, rounded sans-serif. Lawn care, dog walking, tutoring, kids services.',
  },
];

function parseDataset(): string[] {
  const { values } = parseArgs({
    options: { dataset: { type: 'string', default: 'production' } },
    allowPositionals: false,
  });
  const v = values.dataset!;
  if (v === 'all') return ['production', 'development'];
  return [v];
}

async function seedDataset(dataset: string) {
  const client = createWriteClient({ dataset });
  const tx = client.transaction();
  for (const seed of SEEDS) {
    tx.createOrReplace({
      _id: themeDocId(seed.name),
      _type: 'theme',
      name: seed.name,
      displayName: seed.displayName,
      description: seed.description,
    });
  }
  const res = await tx.commit({ visibility: 'sync' });
  console.log(`[seed] dataset=${dataset} themes seeded: ${THEME_NAMES.length} (transactionId=${res.transactionId})`);
}

async function main() {
  const datasets = parseDataset();
  for (const dataset of datasets) {
    await seedDataset(dataset);
  }
  console.log('[seed] done.');
}

main().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
