import { NextResponse } from 'next/server';
import { createWriteClient } from '@leadlandlord/sanity-schema';
import { getDomainStatus } from '@leadlandlord/integrations/vercel';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SanitySiteDomain {
  host: string;
  isPrimary?: boolean;
  verified?: boolean;
  attachedAt?: string;
}

interface SanitySiteRecord {
  _id: string;
  siteId?: string;
  domains: SanitySiteDomain[];
}

const PENDING_QUERY = `*[_type=="site" && count(domains[verified != true]) > 0]{
  _id, siteId, "domains": domains[]{ host, isPrimary, verified, attachedAt }
}`;

/**
 * Vercel Cron entry point. Runs every 5 minutes.
 *
 * Polls Sanity for site docs with unverified domains, asks Vercel for the
 * current verification status of each, and patches Sanity when a domain
 * flips to verified. Idempotent: re-runs are safe; already-verified domains
 * skip the patch.
 *
 * Auth: same Bearer CRON_SECRET pattern as /api/cron/operator-tick.
 *
 * Env required:
 *   - VERCEL_TOKEN, VERCEL_SITES_PROJECT_ID
 *   - SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_TOKEN
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    log.warn({}, 'domain-verifier skipped — VERCEL_SITES_PROJECT_ID not set');
    return NextResponse.json({ ok: false, reason: 'no_sites_project_id' }, { status: 503 });
  }

  const sanity = createWriteClient();
  const sites = await sanity.fetch<SanitySiteRecord[]>(PENDING_QUERY);
  let polled = 0;
  let flipped = 0;
  const errors: Array<{ host: string; error: string }> = [];

  for (const site of sites) {
    for (let i = 0; i < site.domains.length; i++) {
      const d = site.domains[i];
      if (!d || d.verified) continue;
      polled++;
      try {
        const status = await getDomainStatus(projectId, d.host);
        if (status.verified) {
          await sanity
            .patch(site._id)
            .set({ [`domains[${i}].verified`]: true })
            .commit({ visibility: 'sync' });
          flipped++;
          log.info({ siteId: site.siteId, host: d.host }, 'domain verified — patched Sanity');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ host: d.host, error: msg });
        log.warn({ siteId: site.siteId, host: d.host, err: msg }, 'domain-verifier poll failed');
      }
    }
  }

  return NextResponse.json({ ok: true, polled, flipped, errors });
}
