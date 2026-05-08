import { config } from 'dotenv';
import { searchDomains } from '@leadlandlord/integrations/cloudflare';

config({ path: '.env.local' });

async function main() {
  const out = await searchDomains({ niche: 'tree removal', city: 'Tucson', state: 'AZ', topN: 5 });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
