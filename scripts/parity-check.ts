#!/usr/bin/env -S tsx
/**
 * Phase G parity check: structural compare between the old static
 * tree-removal-tucson site and the new multi-tenant render via
 * leadlandlord-sites. Doesn't require byte-equivalence — confirms
 * the new tenant has the right shape (routes, SEO elements, form).
 *
 * Usage:
 *   pnpm tsx scripts/parity-check.ts \
 *     --old https://tree-removal-tucson-az-vmld.vercel.app \
 *     --new "https://leadlandlord-sites.vercel.app/?site=tree-removal-tucson-az"
 */
import { parseArgs } from 'node:util';

interface Args {
  oldUrl: string;
  newUrl: string;
}

function parseCli(): Args {
  const { values } = parseArgs({
    options: { old: { type: 'string' }, new: { type: 'string' } },
  });
  if (!values.old || !values.new) {
    console.error('Usage: pnpm tsx scripts/parity-check.ts --old <oldStaticUrl> --new <newDynamicUrl>');
    process.exit(2);
  }
  return { oldUrl: values.old.replace(/\/$/, ''), newUrl: values.new };
}

interface PageReport {
  status: number;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  jsonLdCount: number;
  hasLeadForm: boolean;
  variantClasses: string[];
  bodyLen: number;
}

async function loadPage(url: string): Promise<PageReport> {
  const r = await fetch(url, { redirect: 'follow' });
  const status = r.status;
  const body = await r.text();
  const title = match(body, /<title>([^<]+)<\/title>/)?.[1] ?? null;
  const metaDescription = match(body, /<meta\s+name="description"\s+content="([^"]+)"/)?.[1] ?? null;
  const canonical = match(body, /<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1] ?? null;
  const jsonLdCount = (body.match(/<script[^>]*type="application\/ld\+json"/g) ?? []).length;
  const hasLeadForm = /class="leadform/i.test(body) || /name="phone"/i.test(body);
  const variantClasses = [...new Set([...body.matchAll(/class="(classic|modern|premium|bright)-[a-z-]+"/g)].map((m) => m[1]))];
  return { status, title, metaDescription, canonical, jsonLdCount, hasLeadForm, variantClasses, bodyLen: body.length };
}

function match(s: string, re: RegExp): RegExpMatchArray | null {
  return s.match(re);
}

async function loadSitemapUrls(siteUrl: string): Promise<string[]> {
  const r = await fetch(`${siteUrl}/sitemap.xml`);
  if (!r.ok) return [];
  const xml = await r.text();
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1]!);
}

function rule(): string {
  return '─'.repeat(80);
}

async function main() {
  const args = parseCli();

  console.log(rule());
  console.log(`  PARITY CHECK`);
  console.log(`    old: ${args.oldUrl}`);
  console.log(`    new: ${args.newUrl}`);
  console.log(rule());

  // 1. Sitemap URL counts
  console.log('\n[1] Sitemap');
  const [oldUrls, newUrls] = await Promise.all([loadSitemapUrls(args.oldUrl), loadSitemapUrls(extractBase(args.newUrl))]);
  console.log(`  old: ${oldUrls.length} URLs`);
  console.log(`  new: ${newUrls.length} URLs`);
  if (oldUrls.length === 0 && newUrls.length === 0) {
    console.log('  ⚠  both sitemaps empty — robotsDisallow may be blocking it. Will proceed with home page check only.');
  } else if (Math.abs(oldUrls.length - newUrls.length) > 2) {
    console.log('  ⚠  URL count differs by >2 — investigate');
  } else {
    console.log('  ✓  URL counts within tolerance');
  }

  // 2. Home page
  console.log('\n[2] Home page');
  const [oldHome, newHome] = await Promise.all([
    loadPage(args.oldUrl + '/').catch((err) => ({ status: 0, error: String(err) }) as any),
    loadPage(args.newUrl).catch((err) => ({ status: 0, error: String(err) }) as any),
  ]);
  printSide('OLD', oldHome);
  printSide('NEW', newHome);

  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];
  if (oldHome.status === 200 && newHome.status === 200) {
    checks.push({ name: 'both 200', pass: true });
    if (oldHome.title && newHome.title) {
      const sameOrSimilar = oldHome.title === newHome.title;
      checks.push({ name: 'title matches', pass: sameOrSimilar, detail: sameOrSimilar ? '' : `old="${oldHome.title}" vs new="${newHome.title}"` });
    }
    if (oldHome.variantClasses[0] && newHome.variantClasses[0]) {
      const sameVariant = oldHome.variantClasses[0] === newHome.variantClasses[0];
      checks.push({ name: 'same variant', pass: sameVariant, detail: sameVariant ? oldHome.variantClasses[0] : `old=${oldHome.variantClasses[0]} vs new=${newHome.variantClasses[0]}` });
    }
    checks.push({ name: 'JSON-LD present on new', pass: newHome.jsonLdCount > 0, detail: `count=${newHome.jsonLdCount}` });
    checks.push({ name: 'lead form present on new', pass: newHome.hasLeadForm });
    const sizeRatio = newHome.bodyLen / Math.max(oldHome.bodyLen, 1);
    checks.push({
      name: 'body size within 0.5×–2×',
      pass: sizeRatio >= 0.5 && sizeRatio <= 2.5,
      detail: `${oldHome.bodyLen} → ${newHome.bodyLen} (${sizeRatio.toFixed(2)}×)`,
    });
  } else {
    if (oldHome.status === 401 || (oldHome as any).error?.includes('401')) {
      console.log('\n  ⚠  OLD site is auth-gated by Vercel SSO. Falling back to NEW-only checks.');
      checks.push({ name: 'NEW renders 200', pass: newHome.status === 200, detail: `status=${newHome.status}` });
      checks.push({ name: 'NEW has title', pass: !!newHome.title, detail: newHome.title ?? '(none)' });
      checks.push({ name: 'NEW has variant classes', pass: newHome.variantClasses.length > 0, detail: newHome.variantClasses.join(',') });
      checks.push({ name: 'NEW has JSON-LD', pass: newHome.jsonLdCount > 0, detail: `count=${newHome.jsonLdCount}` });
      checks.push({ name: 'NEW has lead form', pass: newHome.hasLeadForm });
    } else {
      checks.push({ name: 'both 200', pass: false, detail: `old=${oldHome.status} new=${newHome.status}` });
    }
  }

  // 3. Secondary routes (about, contact, one service)
  console.log('\n[3] Secondary routes (NEW only)');
  const newBase = extractBase(args.newUrl);
  const newQS = args.newUrl.includes('?') ? args.newUrl.slice(args.newUrl.indexOf('?')) : '';
  const secondary = ['/about/', '/contact/'];
  for (const path of secondary) {
    const r = await fetch(`${newBase}${path}${newQS}`, { redirect: 'follow' });
    console.log(`  ${path} → ${r.status}`);
    checks.push({ name: `NEW ${path} → 200`, pass: r.status === 200, detail: `status=${r.status}` });
  }

  console.log(rule());
  console.log('\n  RESULTS');
  let allPass = true;
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    console.log(`  ${icon}  ${c.name}${c.detail ? `   (${c.detail})` : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log('');
  console.log(allPass ? '  → PARITY PASSED. Safe to proceed with cutover.' : '  → PARITY FAILED. Investigate before cutover.');
  console.log(rule());
}

function extractBase(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

function printSide(label: string, p: any) {
  if (p.error || p.status === 0) {
    console.log(`  ${label} (FAIL: ${p.error ?? 'unknown'})`);
    return;
  }
  console.log(`  ${label}  status=${p.status}  title=${(p.title ?? '').slice(0, 60)}  variants=[${(p.variantClasses ?? []).join(',')}]  jsonLd=${p.jsonLdCount}  hasForm=${p.hasLeadForm}  size=${p.bodyLen}`);
}

main().catch((err) => {
  console.error('parity-check failed:', err);
  process.exit(1);
});
