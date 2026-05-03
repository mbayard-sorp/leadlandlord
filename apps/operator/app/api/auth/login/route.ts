import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkPassword, issueSession } from '../../../../lib/auth';

const Body = z.object({ password: z.string() });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!checkPassword(parsed.data.password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const session = issueSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: session.name,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAge,
  });
  return res;
}
