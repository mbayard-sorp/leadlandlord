import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN missing');
  if (!acct) throw new Error('CLOUDFLARE_ACCOUNT_ID missing');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones?account.id=${acct}&per_page=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(`success: ${json.success}`);
  console.log(`zones: ${json.result?.length ?? 0}`);
  if (json.errors?.length) console.log('errors:', json.errors);
  if (json.result?.length) {
    console.log('zone names:', json.result.map((z: { name: string }) => z.name));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
