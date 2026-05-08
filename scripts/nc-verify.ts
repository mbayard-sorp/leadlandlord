import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const u = process.env.NAMECHEAP_API_USER;
  const k = process.env.NAMECHEAP_API_KEY;
  const un = process.env.NAMECHEAP_USERNAME;
  const ip = process.env.NAMECHEAP_CLIENT_IP;
  const useSandbox = process.env.NAMECHEAP_USE_SANDBOX === 'true';
  const base = useSandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response';

  console.log('Endpoint:', base);
  console.log('ApiUser:', u, 'Username:', un, 'ClientIp:', ip);

  // Test 1: domains.check on a known-taken domain — free, no auth surprises
  const params = new URLSearchParams({
    ApiUser: u!,
    ApiKey: k!,
    UserName: un!,
    ClientIp: ip!,
    Command: 'namecheap.domains.check',
    DomainList: 'google.com',
  });
  const url = `${base}?${params.toString()}`;
  const res = await fetch(url);
  const xml = await res.text();
  console.log('\nHTTP', res.status);
  // Parse status and any errors
  const statusMatch = xml.match(/<ApiResponse[^>]*Status="([^"]+)"/);
  const errorMatch = xml.match(/<Error Number="([^"]+)">([^<]+)<\/Error>/);
  const checkMatch = xml.match(/<DomainCheckResult[^>]*Domain="([^"]+)"[^>]*Available="([^"]+)"/);
  console.log('ApiResponse Status:', statusMatch?.[1] ?? '(none)');
  if (errorMatch) {
    console.log('ERROR', errorMatch[1] + ':', errorMatch[2]);
  }
  if (checkMatch) {
    console.log('Domain check result:', checkMatch[1], '→ available =', checkMatch[2]);
  }
  console.log('\nFull response (first 500 chars):');
  console.log(xml.slice(0, 500));
}

main().catch((err) => { console.error(err); process.exit(1); });
