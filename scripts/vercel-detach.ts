import { config } from 'dotenv';
config({ path: '.env.local' });
import { detachDomain } from '@leadlandlord/integrations/vercel';

async function main() {
  const host = process.argv[2];
  if (!host) throw new Error('Usage: pnpm tsx scripts/vercel-detach.ts <hostname>');
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) throw new Error('VERCEL_SITES_PROJECT_ID not set');
  const ok = await detachDomain(projectId, host);
  console.log(`detach ${host}: ${ok ? 'ok' : 'not found'}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
