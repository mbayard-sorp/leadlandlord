import { config } from 'dotenv';
config({ path: '.env.local' });

const NAMECHEAP_BASE = process.env.NAMECHEAP_USE_SANDBOX === 'true'
  ? 'https://api.sandbox.namecheap.com/xml.response'
  : 'https://api.namecheap.com/xml.response';

async function main() {
  const domain = process.argv[2];
  if (!domain) throw new Error('Usage: pnpm tsx scripts/nc-list-records.ts <domain>');
  const [sld, ...t] = domain.split('.');
  const tld = t.join('.');
  const qs = new URLSearchParams({
    ApiUser: process.env.NAMECHEAP_API_USER!,
    ApiKey: process.env.NAMECHEAP_API_KEY!,
    UserName: process.env.NAMECHEAP_USERNAME!,
    ClientIp: process.env.NAMECHEAP_CLIENT_IP!,
    Command: 'namecheap.domains.dns.getHosts',
    SLD: sld,
    TLD: tld,
  });
  const res = await fetch(`${NAMECHEAP_BASE}?${qs}`);
  const xml = await res.text();
  console.log(xml.slice(0, 2000));
}
main().catch((err) => { console.error(err); process.exit(1); });
