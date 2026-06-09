import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BacklinksRedirect() {
  redirect('/operator/links?tab=outreach');
}
