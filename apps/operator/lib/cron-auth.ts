import { NextResponse } from 'next/server';

export function assertCronAuthorized(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.VERCEL_ENV === 'production';
  if (!secret) {
    if (isProd) {
      return NextResponse.json({ ok: false, reason: 'cron not configured' }, { status: 500 });
    }
    console.warn('[cron-auth] CRON_SECRET unset — allowing unauthenticated call (non-prod env)');
    return null;
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  return null;
}
