import { z } from 'zod';
import { vercelFetch } from './client';

/**
 * Vercel Domains API wrapper. Used by Site Builder + the operator dashboard
 * to attach custom domains to the multi-tenant `leadlandlord-sites` project,
 * fetch DNS-instruction details, and poll verification status.
 *
 * Vercel REST endpoints:
 *   POST   /v10/projects/{projectId}/domains
 *   GET    /v9/projects/{projectId}/domains/{domain}/config
 *   GET    /v9/projects/{projectId}/domains/{domain}
 *   DELETE /v10/projects/{projectId}/domains/{domain}
 *
 * Docs: https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project
 */

const VerificationEntrySchema = z.object({
  type: z.string(),
  domain: z.string(),
  value: z.string(),
  reason: z.string().optional(),
});

const ProjectDomainSchema = z.object({
  name: z.string(),
  apexName: z.string().optional(),
  projectId: z.string().optional(),
  redirect: z.string().nullable().optional(),
  redirectStatusCode: z.number().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  customEnvironmentId: z.string().nullable().optional(),
  updatedAt: z.number().optional(),
  createdAt: z.number().optional(),
  verified: z.boolean(),
  verification: z.array(VerificationEntrySchema).default([]),
});
export type ProjectDomain = z.infer<typeof ProjectDomainSchema>;

const DomainConfigSchema = z.object({
  configuredBy: z.enum(['CNAME', 'A', 'http']).nullable().optional(),
  acceptedChallenges: z.array(z.string()).optional(),
  misconfigured: z.boolean(),
  serviceType: z.string().optional(),
  cnames: z.array(z.string()).optional(),
  aValues: z.array(z.string()).optional(),
  conflicts: z.array(z.unknown()).optional(),
});
export type DomainConfig = z.infer<typeof DomainConfigSchema>;

/**
 * Attach a domain to a Vercel project. Idempotent: if the same name is
 * already attached to the same project, Vercel returns the existing record.
 * If it's attached to a *different* project (within the same scope) Vercel
 * returns 409 — we surface that as a normal error (operator must detach
 * from the other project first).
 */
export async function attachDomain(projectId: string, host: string): Promise<ProjectDomain> {
  const res = await vercelFetch<unknown>(`/v10/projects/${encodeURIComponent(projectId)}/domains`, {
    method: 'POST',
    body: { name: host },
  });
  return ProjectDomainSchema.parse(res);
}

/**
 * Fetch DNS configuration details for a domain — what A/CNAME records the
 * registrar needs, and whether they are currently misconfigured.
 */
export async function getDomainConfig(projectId: string, host: string): Promise<DomainConfig> {
  const res = await vercelFetch<unknown>(
    `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}/config`,
  );
  return DomainConfigSchema.parse(res);
}

/**
 * Fetch verification status. `verified: true` means Vercel has confirmed
 * ownership + DNS routing and the cert has been issued. `verification[]`
 * lists any pending challenges (TXT records to add, etc.) when not verified.
 */
export async function getDomainStatus(projectId: string, host: string): Promise<ProjectDomain> {
  const res = await vercelFetch<unknown>(
    `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}`,
  );
  return ProjectDomainSchema.parse(res);
}

/**
 * Detach a domain from a project. Returns true on success (204), false if
 * the domain was not attached.
 */
export async function detachDomain(projectId: string, host: string): Promise<boolean> {
  try {
    await vercelFetch<unknown>(
      `/v10/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}`,
      { method: 'DELETE' },
    );
    return true;
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && (err as { status?: number }).status === 404) {
      return false;
    }
    throw err;
  }
}
