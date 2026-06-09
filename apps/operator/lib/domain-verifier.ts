import { createWriteClient } from '@leadlandlord/sanity-schema';
import { getDomainStatus } from '@leadlandlord/integrations/vercel';
import { log } from '@leadlandlord/shared/log';

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

export interface DomainVerifierResult {
  ok: boolean;
  reason?: string;
  polled?: number;
  flipped?: number;
  errors?: Array<{ host: string; error: string }>;
}

/**
 * Polls Sanity for site docs with unverified domains, asks Vercel for the
 * current verification status of each, and patches Sanity when a domain
 * flips to verified. Idempotent: re-runs are safe; already-verified domains
 * skip the patch.
 *
 * Extracted from /api/cron/domain-verifier so the consolidated /api/cron/tick
 * poll can share it. The standalone route remains for manual triggers.
 *
 * Env required:
 *   - VERCEL_TOKEN, VERCEL_SITES_PROJECT_ID
 *   - SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_TOKEN
 */
export async function runDomainVerifier(): Promise<DomainVerifierResult> {
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    log.warn({}, 'domain-verifier skipped — VERCEL_SITES_PROJECT_ID not set');
    return { ok: false, reason: 'no_sites_project_id' };
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

  return { ok: true, polled, flipped, errors };
}
