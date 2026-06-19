import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily backup cron. Runs at 03:00 UTC.
 *   - Always: Sanity dataset export of `production` to a tmp tarball, then
 *     upload to Vercel Blob at `backups/sanity/${YYYY-MM-DD}.tar.gz`.
 *   - Sundays: Fleet manifest — pull sites + tenants + invoices + agent_budgets
 *     rows and write JSON to `backups/manifest/${YYYY-MM-DD}.json`.
 *
 * The Vercel Blob upload step is gated behind a runtime check for `@vercel/blob`
 * because the package isn't a current workspace dep. When missing we log + skip
 * the upload — the backup tarball still gets generated locally on the runner
 * (visible via Vercel function logs) so an operator can pull it manually.
 */
export async function GET(req: Request) {
  const denied = assertCronAuthorized(req);
  if (denied) return denied;
  const today = new Date().toISOString().slice(0, 10);
  const isSunday = new Date().getUTCDay() === 0;

  const summary: Record<string, unknown> = { date: today, isSunday };

  // 1. Sanity dataset export.
  try {
    const result = await runSanityExport(today);
    summary.sanity = result;
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'sanity export failed');
    summary.sanity = { ok: false, error: String(err) };
  }

  // 2. Weekly fleet manifest (Sundays only).
  if (isSunday) {
    try {
      summary.manifest = await runFleetManifest(today);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, 'fleet manifest failed');
      summary.manifest = { ok: false, error: String(err) };
    }
  }

  return NextResponse.json({ ok: true, summary });
}

interface SanityExportResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  uploadedTo?: string;
  uploadSkipped?: string;
  error?: string;
}

async function runSanityExport(date: string): Promise<SanityExportResult> {
  const projectId = process.env.SANITY_PROJECT_ID || process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET || process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';
  const token = process.env.SANITY_AUTH_TOKEN || process.env.SANITY_API_WRITE_TOKEN;
  if (!projectId || !token) {
    return { ok: false, error: 'SANITY_PROJECT_ID or SANITY_AUTH_TOKEN missing' };
  }
  const dir = await mkdtemp(join(tmpdir(), 'll-backup-'));
  const outPath = join(dir, `${date}.tar.gz`);

  // Spawn the @sanity/cli export. Fail-soft: surface the exit code in the
  // response rather than throwing. The CLI streams its own progress to
  // stderr, which Vercel function logs capture.
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['--yes', '@sanity/cli@latest', 'dataset', 'export', dataset, outPath, '--no-assets'],
      {
        env: {
          ...process.env,
          SANITY_AUTH_TOKEN: token,
          SANITY_STUDIO_API_PROJECT_ID: projectId,
          SANITY_STUDIO_API_DATASET: dataset,
          SANITY_PROJECT_ID: projectId,
          SANITY_DATASET: dataset,
        },
        stdio: 'inherit',
      },
    );
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sanity export exited ${code}`));
    });
  });

  const st = await stat(outPath);
  const blobPath = `backups/sanity/${date}.tar.gz`;
  const upload = await uploadToBlob(blobPath, await readFile(outPath));
  return { ok: true, path: outPath, bytes: st.size, ...upload };
}

interface FleetManifestResult {
  ok: boolean;
  counts?: Record<string, number>;
  uploadedTo?: string;
  uploadSkipped?: string;
}

async function runFleetManifest(date: string): Promise<FleetManifestResult> {
  const db = getDb();
  // Use raw SQL so we don't need to import every table object — the four
  // tables are stable, the manifest is a frozen snapshot, and this avoids
  // tight coupling to schema column drift.
  const sites = await runQuery(db, sql`SELECT * FROM sites`);
  const tenants = await runQuery(db, sql`SELECT * FROM tenants`);
  const invoices = await runQuery(db, sql`SELECT * FROM invoices`);
  const budgets = await runQuery(db, sql`SELECT * FROM agent_budgets`);
  const manifest = {
    generated_at: new Date().toISOString(),
    counts: {
      sites: sites.length,
      tenants: tenants.length,
      invoices: invoices.length,
      agent_budgets: budgets.length,
    },
    sites,
    tenants,
    invoices,
    agent_budgets: budgets,
  };
  const blobPath = `backups/manifest/${date}.json`;
  const upload = await uploadToBlob(blobPath, Buffer.from(JSON.stringify(manifest)));
  return { ok: true, counts: manifest.counts, ...upload };
}

async function runQuery(db: ReturnType<typeof getDb>, q: ReturnType<typeof sql>): Promise<unknown[]> {
  const result = await db.execute(q);
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: unknown[] }).rows;
  }
  return [];
}

/**
 * Conditional Vercel Blob upload. When @vercel/blob isn't installed (current
 * workspace state) we log + return a `uploadSkipped` reason. Operators can
 * `pnpm add @vercel/blob -F @leadlandlord/operator` later and this becomes a
 * no-config-change live upload.
 */
async function uploadToBlob(
  blobPath: string,
  body: Buffer,
): Promise<{ uploadedTo?: string; uploadSkipped?: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    log.warn({ blobPath }, 'BLOB_READ_WRITE_TOKEN missing — skipping upload');
    return { uploadSkipped: 'no_token' };
  }
  try {
    // Dynamic import of an optional, intentionally-uninstalled package. The
    // ignore magic comments stop Turbopack/webpack from statically resolving it
    // at build time (the `as string` cast alone does NOT — Turbopack still
    // resolves it and fails the build). Resolution is deferred to runtime, where
    // the missing package rejects and is caught → null.
    // TODO: add `@vercel/blob` to apps/operator/package.json once we confirm
    // the cron path runs end-to-end with sanity export.
    const blob = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@vercel/blob' as string).catch(() => null);
    if (!blob || typeof (blob as { put?: unknown }).put !== 'function') {
      log.warn({ blobPath }, '@vercel/blob not installed — skipping upload');
      return { uploadSkipped: 'pkg_not_installed' };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { url } = await (blob as any).put(blobPath, body, {
      access: 'public',
      addRandomSuffix: false,
    });
    return { uploadedTo: url };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err, blobPath }, 'blob upload failed');
    return { uploadSkipped: 'upload_error' };
  }
}
