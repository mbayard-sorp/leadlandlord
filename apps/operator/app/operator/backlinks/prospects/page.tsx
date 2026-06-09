import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function ProspectsRedirect() {
  redirect('/operator/links?tab=prospects');
}
