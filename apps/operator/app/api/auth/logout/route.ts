import { NextResponse } from 'next/server';
import { sessionCookieName } from '../../../../lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: sessionCookieName(),
    value: '',
    path: '/',
    maxAge: 0,
  });
  return res;
}
