/**
 * Decommission A0 inventory. READ-ONLY: lists what we own at each provider so
 * the teardown phases (A1 auto-renew, A4 release/delete) have a checklist.
 *
 *   - Twilio: every incoming number on the account + its voice/SMS webhook
 *   - Namecheap: every domain on the account + expiry + auto-renew
 *   - Cloudflare: registrar domains (auto-renew, expiry) + DNS zones
 *
 * Makes only GET/list calls (Namecheap goes through the proxy when
 * NAMECHEAP_PROXY_URL is set, same as packages/integrations/src/namecheap).
 * Never registers, releases, or edits anything.
 *
 * Usage: pnpm tsx scripts/decommission-inventory.ts [--json <outfile>]
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';

config({ path: '.env.local' });

const KEEP_DOMAINS = new Set(['karkens.com', 'tesshauling.com', 'leadslandlord.com', 'constructionadrservices.com']);

type Row = Record<string, string | number | boolean | null>;

async function twilioNumbers(): Promise<Row[]> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return [{ error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing' }];
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const rows: Row[] = [];
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=200`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) return [{ error: `Twilio HTTP ${res.status}` }];
    const json = (await res.json()) as {
      incoming_phone_numbers: Array<Record<string, string | null>>;
      next_page_uri: string | null;
    };
    for (const n of json.incoming_phone_numbers) {
      rows.push({
        sid: n.sid ?? null,
        number: n.phone_number ?? null,
        name: n.friendly_name ?? null,
        voiceUrl: n.voice_url ?? null,
        smsUrl: n.sms_url ?? null,
        created: n.date_created ?? null,
      });
    }
    url = json.next_page_uri ? `https://api.twilio.com${json.next_page_uri}` : null;
  }
  return rows;
}

function xmlAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

async function namecheapDomains(): Promise<Row[]> {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const username = process.env.NAMECHEAP_USERNAME ?? apiUser;
  const clientIp = process.env.NAMECHEAP_CLIENT_IP;
  if (!apiUser || !apiKey || !clientIp) return [{ error: 'NAMECHEAP_API_USER / _API_KEY / _CLIENT_IP missing' }];
  const proxyUrl = process.env.NAMECHEAP_PROXY_URL?.trim();
  const proxySecret = process.env.NAMECHEAP_PROXY_SECRET?.trim();
  const rows: Row[] = [];
  for (let page = 1; page <= 20; page++) {
    const params: Record<string, string> = {
      ApiUser: apiUser,
      ApiKey: apiKey,
      UserName: username!,
      ClientIp: clientIp,
      PageSize: '100',
      Page: String(page),
    };
    const command = 'namecheap.domains.getList';
    const res = proxyUrl
      ? await fetch(`${proxyUrl.replace(/\/$/, '')}/forward`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-proxy-secret': proxySecret ?? '' },
          body: JSON.stringify({ command, params, sandbox: false }),
        })
      : await fetch(`https://api.namecheap.com/xml.response?${new URLSearchParams({ Command: command, ...params })}`);
    const text = await res.text();
    if (!res.ok || /Status="ERROR"/i.test(text)) return [{ error: `Namecheap: ${text.slice(0, 300)}` }];
    const domains = [...text.matchAll(/<Domain\s[^>]*\/?>/g)].map((m) => xmlAttrs(m[0]));
    for (const d of domains) {
      rows.push({
        domain: d.Name ?? null,
        expires: d.Expires ?? null,
        autoRenew: d.AutoRenew === 'true',
        isExpired: d.IsExpired === 'true',
        keep: KEEP_DOMAINS.has((d.Name ?? '').toLowerCase()),
      });
    }
    if (domains.length < 100) break;
  }
  return rows;
}

async function cloudflare(): Promise<{ registrar: Row[]; zones: Row[] }> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acct) {
    const e = [{ error: 'CLOUDFLARE_API_TOKEN / _ACCOUNT_ID missing' }];
    return { registrar: e, zones: e };
  }
  const h = { Authorization: `Bearer ${token}` };
  const reg = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/registrar/domains`, { headers: h });
  const regJson = (await reg.json()) as { success: boolean; result?: Array<Record<string, unknown>>; errors?: unknown };
  const registrar: Row[] = regJson.success
    ? (regJson.result ?? []).map((d) => ({
        domain: String(d.name ?? ''),
        expires: String(d.expires_at ?? ''),
        autoRenew: Boolean(d.auto_renew),
        keep: KEEP_DOMAINS.has(String(d.name ?? '').toLowerCase()),
      }))
    : [{ error: `Cloudflare registrar: ${JSON.stringify(regJson.errors)}` }];
  const zr = await fetch(`https://api.cloudflare.com/client/v4/zones?account.id=${acct}&per_page=50`, { headers: h });
  const zj = (await zr.json()) as { success: boolean; result?: Array<Record<string, unknown>>; errors?: unknown };
  const zones: Row[] = zj.success
    ? (zj.result ?? []).map((z) => ({ zone: String(z.name ?? ''), id: String(z.id ?? ''), status: String(z.status ?? '') }))
    : [{ error: `Cloudflare zones: ${JSON.stringify(zj.errors)}` }];
  return { registrar, zones };
}

async function main() {
  const [twilio, namecheap, cf] = await Promise.all([twilioNumbers(), namecheapDomains(), cloudflare()]);
  console.log(`\n== Twilio numbers (${twilio.length})`);
  console.table(twilio);
  console.log(`\n== Namecheap domains (${namecheap.length})`);
  console.table(namecheap);
  console.log(`\n== Cloudflare registrar domains (${cf.registrar.length})`);
  console.table(cf.registrar);
  console.log(`\n== Cloudflare zones (${cf.zones.length})`);
  console.table(cf.zones);

  const outIdx = process.argv.indexOf('--json');
  if (outIdx > -1 && process.argv[outIdx + 1]) {
    const out = { capturedAt: new Date().toISOString(), twilio, namecheap, cloudflare: cf };
    writeFileSync(process.argv[outIdx + 1]!, JSON.stringify(out, null, 2));
    console.log(`\nwrote ${process.argv[outIdx + 1]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
