import { eq, and, isNotNull } from 'drizzle-orm';
import { createWriteClient } from '@leadlandlord/sanity-schema';
import { getDomainStatus } from '@leadlandlord/integrations/vercel';
import { getDb, buildsellSites } from '@leadlandlord/db';
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
  /** B&S counters — single-domain-per-site, polled from Postgres buildsell_sites. */
  buildsellPolled?: number;
  buildsellFlipped?: number;
}

/**
 * Polls Sanity for site docs with unverified domains, asks Vercel for the
 * current verification status of each, and patches Sanity when a domain
 * flips to verified. Idempotent: re-runs are safe; already-verified domains
 * skip the patch.
 *
 * Also polls the B&S (Build & Sell) side — buildsell_sites rows with a
 * pending customDomain. Unlike R&R's multi-domain Sanity `domains[]`, B&S
 * is single-domain and Postgres-authoritative: on verify we flip
 * domainStatus/domainVerifiedAt in Postgres only. No Sanity re-patch needed
 * there since customDomain presence (not verified-ness) is what
 * fetchBuildSellSiteByHost keys resolution on.
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

  // ── B&S branch ──────────────────────────────────────────────────────────
  let buildsellPolled = 0;
  let buildsellFlipped = 0;
  try {
    const db = getDb();
    const pendingSites = await db
      .select()
      .from(buildsellSites)
      .where(and(eq(buildsellSites.domainStatus, 'pending'), isNotNull(buildsellSites.customDomain)));

    for (const site of pendingSites) {
      if (!site.customDomain) continue;
      buildsellPolled++;
      try {
        const status = await getDomainStatus(projectId, site.customDomain);
        if (status.verified) {
          await db
            .update(buildsellSites)
            .set({ domainStatus: 'verified', domainVerifiedAt: new Date() })
            .where(eq(buildsellSites.id, site.id));
          buildsellFlipped++;
          log.info({ siteId: site.id, host: site.customDomain }, 'buildsell domain verified — flipped Postgres');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ host: site.customDomain, error: msg });
        log.warn({ siteId: site.id, host: site.customDomain, err: msg }, 'buildsell domain-verifier poll failed');
      }
    }
  } catch (err) {
    log.warn({ err }, 'buildsell domain-verifier: db query failed');
  }

  return { ok: true, polled, flipped, errors, buildsellPolled, buildsellFlipped };
}
