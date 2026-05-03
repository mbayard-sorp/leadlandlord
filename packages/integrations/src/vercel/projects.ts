import { z } from 'zod';
import { vercelFetch } from './client.js';
import type { VercelProject } from './types.js';

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string(),
  framework: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const EdgeConfigSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
});

export interface CreateProjectArgs {
  name: string;
  framework?: 'nextjs' | 'astro' | 'sveltekit' | null;
  envVars?: Record<string, string>;
}

/**
 * Create a new Vercel project. Idempotent: if a project with the same name
 * exists, returns it instead of erroring.
 */
export async function createProject({
  name,
  framework = 'nextjs',
  envVars,
}: CreateProjectArgs): Promise<VercelProject> {
  const existing = await findProjectByName(name);
  if (existing) return existing;

  const body = {
    name,
    framework,
    environmentVariables: envVars
      ? Object.entries(envVars).map(([key, value]) => ({
          key,
          value,
          type: 'encrypted',
          target: ['production', 'preview', 'development'],
        }))
      : undefined,
  };

  const created = await vercelFetch<unknown>('/v9/projects', { method: 'POST', body });
  return ProjectSchema.parse(created);
}

export async function findProjectByName(name: string): Promise<VercelProject | null> {
  try {
    const res = await vercelFetch<{ projects: unknown[] }>(`/v9/projects?search=${encodeURIComponent(name)}&limit=20`);
    const matches = res.projects.map((p) => ProjectSchema.parse(p)).filter((p) => p.name === name);
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Create an Edge Config and connect it to a project.
 * Used to store the rotating tracking number for a tenant site.
 *
 * NOTE: Phase 1 stubs this out — the live tenant site reads the tracking
 * number from a build-time env var. Edge Config swap-without-redeploy is a
 * Phase 2 enhancement.
 */
export async function attachEdgeConfig({
  projectId: _projectId,
  initialItems: _initialItems,
}: {
  projectId: string;
  initialItems: Record<string, string>;
}): Promise<{ edgeConfigId: string }> {
  // TODO(phase-2): POST /v1/edge-config, PATCH /v1/edge-config/:id/items, POST /v1/edge-config/:id/connection
  return { edgeConfigId: 'stub-edge-config' };
}

/**
 * Set environment variables on a project.
 */
export async function setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(vars).map(([key, value]) =>
      vercelFetch(`/v10/projects/${projectId}/env?upsert=true`, {
        method: 'POST',
        body: { key, value, type: 'encrypted', target: ['production', 'preview', 'development'] },
      }),
    ),
  );
}

export { EdgeConfigSchema };
