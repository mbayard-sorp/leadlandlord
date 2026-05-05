import { createClient, type SanityClient } from '@sanity/client';

const DEFAULT_API_VERSION = '2024-10-01';

export interface SanityClientOptions {
  projectId?: string;
  dataset?: string;
  token?: string;
  apiVersion?: string;
  useCdn?: boolean;
}

function resolve(opts: SanityClientOptions, requireToken: boolean): {
  projectId: string;
  dataset: string;
  token?: string;
  apiVersion: string;
  useCdn: boolean;
} {
  const projectId = opts.projectId ?? process.env.SANITY_PROJECT_ID ?? process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  const dataset = opts.dataset ?? process.env.SANITY_DATASET ?? process.env.NEXT_PUBLIC_SANITY_DATASET;
  const token = opts.token ?? process.env.SANITY_API_TOKEN;

  if (!projectId) throw new Error('Sanity client: SANITY_PROJECT_ID is not set');
  if (!dataset) throw new Error('Sanity client: SANITY_DATASET is not set');
  if (requireToken && !token) throw new Error('Sanity client: SANITY_API_TOKEN is required for write client');

  return {
    projectId,
    dataset,
    token,
    apiVersion: opts.apiVersion ?? DEFAULT_API_VERSION,
    useCdn: opts.useCdn ?? false,
  };
}

/** Read-only client. Hits CDN by default; safe for unauthenticated server reads. */
export function createReadClient(opts: SanityClientOptions = {}): SanityClient {
  const r = resolve({ ...opts, useCdn: opts.useCdn ?? true }, false);
  return createClient({
    projectId: r.projectId,
    dataset: r.dataset,
    apiVersion: r.apiVersion,
    useCdn: r.useCdn,
    perspective: 'published',
  });
}

/** Write client. Requires SANITY_API_TOKEN. Server-only — never expose to browsers. */
export function createWriteClient(opts: SanityClientOptions = {}): SanityClient {
  const r = resolve({ ...opts, useCdn: false }, true);
  return createClient({
    projectId: r.projectId,
    dataset: r.dataset,
    apiVersion: r.apiVersion,
    token: r.token,
    useCdn: false,
    perspective: 'raw',
  });
}
