'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  sites,
  domainCandidates,
  agentEvents,
  type DomainCandidate,
} from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type DomainCandidateRow = DomainCandidate;

/**
 * Enqueue a domain-procurer 'search' event for a site. The agent walks
 * registrar APIs and inserts rows into domainCandidates with status
 * 'available' or 'pending_approval'.
 */
export async function searchDomainsForSite(siteId: string): Promise<ActionResult> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  await db.insert(agentEvents).values({
    id: randomUUID(),
    agent: 'operator-dashboard',
    type: 'domain.search-requested',
    targetAgent: 'domain-procurer',
    payload: {
      site_id: siteId,
      action: 'search',
      niche: site.niche,
      city: site.city,
      state: site.state,
      niche_id: site.nicheId ?? undefined,
    },
  });
  log.info({ siteId }, 'domain search enqueued');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

/**
 * Approve a pending_approval domain candidate. Flips the row to 'approved'
 * and emits a `domain.approval.granted` event for Domain Procurer to pick
 * up and register.
 */
export async function approveDomainCandidate(
  siteId: string,
  candidateId: string,
): Promise<ActionResult> {
  const db = getDb();
  const candidate = (
    await db
      .select()
      .from(domainCandidates)
      .where(and(eq(domainCandidates.id, candidateId), eq(domainCandidates.siteId, siteId)))
      .limit(1)
  )[0];
  if (!candidate) return { ok: false, message: 'candidate not found' };
  if (candidate.status !== 'pending_approval') {
    return { ok: false, message: `cannot approve from status=${candidate.status}` };
  }
  await db
    .update(domainCandidates)
    .set({ status: 'approved' })
    .where(eq(domainCandidates.id, candidateId));
  await db.insert(agentEvents).values({
    id: randomUUID(),
    agent: 'operator-dashboard',
    type: 'domain.approval.granted',
    targetAgent: 'domain-procurer',
    payload: {
      site_id: siteId,
      candidate_id: candidateId,
      domain: candidate.domain,
      registrar: candidate.registrar,
      action: 'register',
      human_approved: true,
    },
  });
  log.info({ siteId, candidateId, domain: candidate.domain }, 'domain approval granted');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}
