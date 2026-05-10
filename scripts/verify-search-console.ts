/**
 * Add a Google Search Console domain-property TXT verification record to
 * a Namecheap-hosted domain's DNS, so GSC can verify ownership without
 * the operator hand-editing DNS records in the Namecheap dashboard.
 *
 * Usage:
 *   pnpm tsx scripts/verify-search-console.ts <domain> <gsc-token>
 *
 * Where <gsc-token> is the full string Google shows in
 *   Search Console → Domain property → Verify ownership → DNS TXT
 * (e.g. "google-site-verification=AbCdEfGh1234...").
 *
 * The TXT record is written at the apex (`@`) and the existing host
 * records are preserved (the underlying helper does a getHosts → merge
 * → setHosts cycle, since `setHosts` is destructive).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { addTxtRecord } from '@leadlandlord/integrations/namecheap';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const TOKEN_PREFIX = 'google-site-verification=';

async function main(): Promise<void> {
  const [, , domainArg, tokenArg] = process.argv;
  if (!domainArg || !tokenArg) {
    throw new Error(
      'Usage: pnpm tsx scripts/verify-search-console.ts <domain> <gsc-token>\n' +
        '  e.g. pnpm tsx scripts/verify-search-console.ts leadlandlord.com "google-site-verification=abc123..."',
    );
  }
  const domain = domainArg.trim().toLowerCase();
  const token = tokenArg.trim();

  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid domain "${domain}" — expected something like "example.com".`);
  }
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error(
      `Invalid GSC token — must start with "${TOKEN_PREFIX}". ` +
        `Copy the full TXT value Google shows in Search Console.`,
    );
  }
  if (token.length <= TOKEN_PREFIX.length) {
    throw new Error('Invalid GSC token — value is empty after the prefix.');
  }

  console.log(`Adding GSC TXT record on ${domain}…`);
  const { replaced, records } = await addTxtRecord({
    domain,
    hostName: '@',
    value: token,
  });

  console.log(
    `${replaced ? 'Replaced' : 'Added'} TXT @ ${domain} (${records.length} total records on the domain now).`,
  );
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open Google Search Console → your Domain property → Verify ownership.');
  console.log("  2. Click 'Verify'. DNS may take 5–60 minutes to propagate before Google sees it.");
  console.log('  3. If verification fails on first try, wait a few minutes and click Verify again.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
