#!/usr/bin/env -S tsx
/**
 * Phase D verification: patch Sanity content + theme on the test tenant
 * to prove edits propagate to the live site.
 *
 * Usage:
 *   pnpm tsx scripts/edit-test-tenant.ts title    # edit home title
 *   pnpm tsx scripts/edit-test-tenant.ts theme classic|modern|premium|bright
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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

import { createWriteClient } from '@leadlandlord/sanity-schema/client';
import { siteDocId, pageDocId, themeDocId, type ThemeName } from '@leadlandlord/sanity-schema/ids';

const SITE_ID = '00000000-0000-0000-0000-000000000d4d';

async function editTitle() {
  const sanity = createWriteClient({ dataset: 'development' });
  const newTitle = `Junk Removal in Phase D City, ZZ - edit ${new Date().toISOString().slice(11, 19)}`;
  await sanity
    .patch(pageDocId(SITE_ID, 'home', 0))
    .set({ title: newTitle })
    .commit({ visibility: 'sync' });
  console.log(`OK - home title is now: ${newTitle}`);
}

async function setTheme(theme: ThemeName) {
  const sanity = createWriteClient({ dataset: 'development' });
  await sanity
    .patch(siteDocId(SITE_ID))
    .set({ theme: { _ref: themeDocId(theme), _type: 'reference' } })
    .commit({ visibility: 'sync' });
  console.log(`OK - theme is now: ${theme}`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'title') {
    await editTitle();
  } else if (cmd === 'theme') {
    const theme = process.argv[3] as ThemeName;
    if (!['classic', 'modern', 'premium', 'bright', 'haul', 'counsel'].includes(theme)) {
      console.error('usage: edit-test-tenant.ts theme classic|modern|premium|bright|haul|counsel');
      process.exit(1);
    }
    await setTheme(theme);
  } else {
    console.error('usage: edit-test-tenant.ts title | theme <name>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
