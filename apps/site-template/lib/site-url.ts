/**
 * Resolve the canonical site URL for the current build.
 *
 * Priority:
 *   1. NEXT_PUBLIC_SITE_URL — explicitly configured (preferred for prod custom domain)
 *   2. NEXT_PUBLIC_VERCEL_URL — Vercel preview deployment
 *   3. localhost fallback for `next dev` and tests
 *
 * Always returns a URL with no trailing slash — append paths with a leading slash.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

/** Absolute URL for a path on this site. Path should start with '/'. */
export function absoluteUrl(path: string): string {
  const base = siteUrl();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
