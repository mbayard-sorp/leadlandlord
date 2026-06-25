/**
 * Neon Auth API route handler.
 *
 * Mounts the Neon Auth proxy at /api/auth/[...path]. This is required: the
 * `@neondatabase/auth/next` client-side auth flow POSTs sign-in/sign-out/session
 * requests through this route, which proxies them to NEON_AUTH_BASE_URL and
 * manages the signed session cookie on the response.
 *
 * auth().handler() is provided by `@neondatabase/auth/next/server`:
 *   createNeonAuth(config).handler() -> { GET, POST, PUT, DELETE, PATCH }
 *
 * We defer handler construction to request time (not module evaluation) so that
 * `next build` succeeds without Neon Auth env vars set.
 */

import { auth } from '@/lib/auth';
import type { NextRequest } from 'next/server';

type Params = { path: string[] };

function handle(request: NextRequest, context: { params: Promise<Params> }) {
  const method = request.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  return auth().handler()[method](request, context);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
