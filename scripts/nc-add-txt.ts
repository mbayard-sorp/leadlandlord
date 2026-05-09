/**
 * Add (or update) a TXT record on a Namecheap-hosted domain without
 * blowing away existing records. `domains.dns.setHosts` REPLACES the
 * entire host list, so we fetch existing records first, splice the new
 * one in, then write the combined list back.
 *
 * Usage:
 *   pnpm tsx scripts/nc-add-txt.ts <domain> <hostname> "<value>"
 *   pnpm tsx scripts/nc-add-txt.ts junk-removal-vegas.com @ "google-site-verification=..."
 *   pnpm tsx scripts/nc-add-txt.ts junk-removal-vegas.com _dmarc "v=DMARC1; p=none"
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const NAMECHEAP_BASE = process.env.NAMECHEAP_USE_SANDBOX === 'true'
  ? 'https://api.sandbox.namecheap.com/xml.response'
  : 'https://api.namecheap.com/xml.response';

interface Host {
  name: string;
  type: string;
  address: string;
  ttl: string;
  mxPref?: string;
}

function attr(xml: string, tag: string, attribute: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attribute}="([^"]*)"`, 'g');
  const m = re.exec(xml);
  return m ? m[1] : null;
}

function findAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^/>]*?(\\/>|>[\\s\\S]*?<\\/${tag}>)`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}

async function ncRequest(command: string, params: Record<string, string>): Promise<string> {
  const u = process.env.NAMECHEAP_API_USER!;
  const k = process.env.NAMECHEAP_API_KEY!;
  const un = process.env.NAMECHEAP_USERNAME!;
  const ip = process.env.NAMECHEAP_CLIENT_IP!;
  const qs = new URLSearchParams({
    ApiUser: u, ApiKey: k, UserName: un, ClientIp: ip, Command: command, ...params,
  });
  const res = await fetch(`${NAMECHEAP_BASE}?${qs}`);
  const xml = await res.text();
  const status = xml.match(/<ApiResponse[^>]*Status="([^"]+)"/)?.[1];
  if (status !== 'OK') {
    const err = xml.match(/<Error Number="\d+">([^<]+)<\/Error>/)?.[1] ?? '(no error message)';
    throw new Error(`Namecheap ${command} failed: ${err}\n${xml.slice(0, 500)}`);
  }
  return xml;
}

async function main() {
  const [domain, hostName, value] = process.argv.slice(2);
  if (!domain || !hostName || !value) {
    throw new Error('Usage: pnpm tsx scripts/nc-add-txt.ts <domain> <hostname> "<value>"');
  }
  const [sld, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.');

  // 1. Fetch existing
  const xml = await ncRequest('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  const hostNodes = findAll(xml, 'host');
  const existing: Host[] = hostNodes.map((node) => ({
    name: attr(node, 'host', 'Name') ?? '',
    type: attr(node, 'host', 'Type') ?? '',
    address: attr(node, 'host', 'Address') ?? '',
    ttl: attr(node, 'host', 'TTL') ?? '1800',
    mxPref: attr(node, 'host', 'MXPref') ?? undefined,
  }));
  console.log(`Existing records (${existing.length}):`);
  for (const h of existing) console.log(`  ${h.name.padEnd(20)} ${h.type.padEnd(8)} ${h.address}`);

  // 2. Compose new list — replace match by (name, type) if exists, else append
  const isReplace = existing.find((h) => h.name === hostName && h.type === 'TXT');
  const next = isReplace
    ? existing.map((h) => (h.name === hostName && h.type === 'TXT' ? { ...h, address: value } : h))
    : [...existing, { name: hostName, type: 'TXT', address: value, ttl: '1800' }];

  console.log(`\n${isReplace ? 'Replacing' : 'Adding'} TXT @ ${hostName}: ${value.slice(0, 60)}${value.length > 60 ? '…' : ''}`);

  // 3. Write back via setHosts
  const params: Record<string, string> = { SLD: sld, TLD: tld };
  next.forEach((h, i) => {
    const idx = i + 1;
    params[`HostName${idx}`] = h.name;
    params[`RecordType${idx}`] = h.type;
    params[`Address${idx}`] = h.address;
    params[`TTL${idx}`] = h.ttl;
    if (h.mxPref && h.type === 'MX') params[`MXPref${idx}`] = h.mxPref;
  });
  await ncRequest('namecheap.domains.dns.setHosts', params);
  console.log(`\nDone. ${next.length} records now set on ${domain}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
