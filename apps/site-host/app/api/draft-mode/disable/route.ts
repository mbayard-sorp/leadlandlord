import { draftMode } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  (await draftMode()).disable();
  return NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_SITE_HOST_URL ?? 'http://localhost:3001'));
}
