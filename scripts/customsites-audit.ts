/**
 * Custom Sites content audit — validates every cs* document against the live
 * Studio schema and reports what Sanity's own validation panel would flag:
 * block types that are not valid for the page builder, unknown/stale fields,
 * empty required fields, array items missing `_key`, values outside an
 * options list, and references that dangle, point at the wrong type, or cross
 * a site boundary.
 *
 * Run after any cs* schema change, and before seeding or deploying a site:
 *   pnpm customsites-audit               # development dataset
 *   pnpm customsites-audit production
 *
 * Read-only: it fetches documents and prints findings, and never writes.
 */
import { createRequire } from 'node:module';

// The schema package imports `sanity`, which pulls in a CSS file node cannot
// parse. Stub the extension before requiring it — this is the only way to load
// the real schema definitions outside a bundler.
const require = createRequire(import.meta.url);
(require as unknown as { extensions: Record<string, unknown> }).extensions['.css'] = () => {};
const { createClient } = require('@sanity/client');
const { customSitesSchemaTypes } = require('@leadlandlord/sanity-schema');


type Def = any;

/** Records whether a field's validation chain calls .required(). */
function isRequired(field: Def): boolean {
  if (typeof field?.validation !== 'function') return false;
  let required = false;
  const rule: any = new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === 'required') return () => { required = true; return rule; };
      return () => rule;
    },
    apply() { return rule; },
  });
  try { field.validation(rule); } catch { /* context-dependent rule — treat as optional */ }
  return required;
}

const named = new Map<string, Def>();
for (const t of customSitesSchemaTypes as Def[]) named.set(t.name, t);

/** An array `of` entry names itself either explicitly or by its type. */
const memberName = (m: Def) => m.name ?? m.type;

/** Resolve a member/field to the definition that owns its `fields`/`of`. */
function resolve(def: Def): Def {
  let cur = def;
  const seen = new Set<string>();
  while (cur && !cur.fields && !cur.of && named.has(cur.type) && !seen.has(cur.type)) {
    seen.add(cur.type);
    cur = named.get(cur.type);
  }
  return cur ?? def;
}

interface Problem { doc: string; path: string; kind: string; detail: string }
const problems: Problem[] = [];
const docsById = new Map<string, any>();
const add = (doc: string, path: string, kind: string, detail: string) => problems.push({ doc, path, kind, detail });

const PORTABLE_TEXT = new Set(['block', 'image', 'csBody']);

function checkValue(value: any, def: Def, path: string, doc: string, siteRef: string | null) {
  if (value == null) return;
  const r = resolve(def);
  const type = r.type ?? def.type;

  if (Array.isArray(value) || type === 'array' || r.of) {
    if (!Array.isArray(value)) { add(doc, path, 'type-mismatch', `expected an array, got ${typeof value}`); return; }
    const members = new Map<string, Def>((r.of ?? []).map((m: Def) => [memberName(m), m]));
    // Portable text arrays carry `block` members Studio owns — don't walk them.
    const isPortableText = [...members.keys()].some((k) => PORTABLE_TEXT.has(k));
    value.forEach((item, i) => {
      const p = `${path}[${i}]`;
      if (!item || typeof item !== 'object') return;
      if (!item._key) add(doc, p, 'missing-key', 'array item has no _key');
      if (isPortableText) return;
      const t = item._type;
      if (!t) { add(doc, p, 'no-type', 'array item has no _type'); return; }
      if (members.size && !members.has(t)) {
        add(doc, p, 'not-valid-for-list', `_type "${t}" is not one of: ${[...members.keys()].join(', ')}`);
        return;
      }
      checkObjectAgainst(item, members.get(t) ?? named.get(t), p, doc, siteRef);
    });
    return;
  }

  if (type === 'reference') { checkReference(value, r, path, doc, siteRef); return; }

  if (r.fields) { checkObjectAgainst(value, r, path, doc, siteRef); return; }

  const list = def.options?.list ?? r.options?.list;
  if (Array.isArray(list) && (typeof value === 'string' || typeof value === 'number')) {
    const allowed = list.map((o: any) => (o && typeof o === 'object' ? o.value : o));
    if (!allowed.includes(value)) add(doc, path, 'bad-list-value', `"${value}" not in: ${allowed.join(', ')}`);
  }
}

function checkReference(value: any, def: Def, path: string, doc: string, siteRef: string | null) {
  const ref = value?._ref;
  if (!ref) return;
  const target = docsById.get(ref);
  if (!target) { add(doc, path, 'dangling-ref', `_ref "${ref}" resolves to nothing`); return; }
  const allowed = (def.to ?? []).map((t: Def) => t.type);
  if (allowed.length && !allowed.includes(target._type)) {
    add(doc, path, 'wrong-ref-type', `points at ${target._type}, allowed: ${allowed.join(', ')}`);
  }
  const targetSite = target.site?._ref ?? null;
  if (siteRef && targetSite && targetSite !== siteRef) {
    add(doc, path, 'cross-site-ref', `points at a doc owned by another site (${targetSite})`);
  }
}

/** Built-in members Studio adds to image/file fields on top of custom `fields`. */
const ASSET_KEYS = new Set(['asset', 'hotspot', 'crop', 'media']);

function checkObjectAgainst(value: any, def: Def, path: string, doc: string, siteRef: string | null) {
  const r = def ? resolve(def) : undefined;
  if (!r?.fields) return;
  const isAsset = r.type === 'image' || r.type === 'file';
  const fields = new Map<string, Def>(r.fields.map((f: Def) => [f.name, f]));
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('_')) continue;
    if (isAsset && ASSET_KEYS.has(k)) continue;
    const field = fields.get(k);
    if (!field) { add(doc, `${path}.${k}`, 'unknown-field', `not declared on ${r.name ?? r.type}`); continue; }
    checkValue(v, field, `${path}.${k}`, doc, siteRef);
  }
  for (const f of r.fields) {
    if (isRequired(f) && value[f.name] == null) add(doc, `${path}.${f.name}`, 'missing-required', `required on ${r.name ?? r.type}`);
  }
}

const dataset = process.argv[2] ?? 'development';
const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID ?? 'ybdv5za2',
  dataset,
  apiVersion: '2024-01-01',
  token: process.env.SANITY_API_READ_TOKEN ?? process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
});

async function main() {
  const docs: any[] = await client.fetch('*[_type match "cs*"]');
  for (const d of docs) docsById.set(d._id, d);

  const pageDef = named.get('csPage');
  const builder = pageDef.fields.find((f: Def) => f.name === 'pageBuilder');
  const allowedBlocks = new Map<string, Def>(builder.of.map((m: Def) => [memberName(m), m]));

  const siteKeyById = new Map<string, string>();
  for (const d of docs) if (d._type === 'csSite') siteKeyById.set(d._id, d.siteKey);

  let blocks = 0;
  for (const page of docs.filter((d) => d._type === 'csPage')) {
    const siteRef = page.site?._ref ?? null;
    const label = `${siteRef ? siteKeyById.get(siteRef) ?? '?' : '?'}/${page.slug?.current ?? page._id}`;
    (page.pageBuilder ?? []).forEach((block: any, i: number) => {
      blocks++;
      const path = `pageBuilder[${i}] ${block?._type ?? '(no _type)'}`;
      if (!block?._key) add(label, path, 'missing-key', 'block has no _key');
      if (!block?._type) { add(label, path, 'no-type', 'block has no _type'); return; }
      if (!allowedBlocks.has(block._type)) {
        add(label, path, 'not-valid-for-list', `"${block._type}" is not a csPage.pageBuilder member`);
        return;
      }
      checkObjectAgainst(block, allowedBlocks.get(block._type), path, label, siteRef);
    });
  }

  // Whole-document pass: every cs* doc validated against its own type, which
  // is what Studio's validation panel reports on.
  let fullDocs = 0;
  for (const doc of docs) {
    const def = named.get(doc._type);
    if (!def) { add(doc._id, '', 'unknown-doc-type', `_type "${doc._type}" is not a registered schema type`); continue; }
    if (doc._type === 'csPage') continue; // already walked above
    fullDocs++;
    const siteRef = doc.site?._ref ?? null;
    const label = `${siteRef ? siteKeyById.get(siteRef) ?? '?' : '-'}/${doc._type}:${doc.slug?.current ?? doc.siteKey ?? doc._id}`;
    checkObjectAgainst(doc, def, '', label, siteRef);
  }

  console.log(`dataset=${dataset}: ${docs.filter((d) => d._type === 'csPage').length} csPage docs, ${blocks} blocks, ${allowedBlocks.size} allowed block types, ${fullDocs} other cs docs\n`);
  const byDoc = new Map<string, Problem[]>();
  for (const p of problems) { const l = byDoc.get(p.doc) ?? []; l.push(p); byDoc.set(p.doc, l); }
  for (const [d, list] of [...byDoc.entries()].sort()) {
    console.log(`## ${d}`);
    for (const p of list) console.log(`  [${p.kind}] ${p.path} — ${p.detail}`);
    console.log();
  }
  if (problems.length === 0) {
    console.log('No problems found.');
    return;
  }
  console.log(`total problems: ${problems.length}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
