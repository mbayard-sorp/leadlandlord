import { getDb, sites, inArray } from '@leadlandlord/db';
import Link from 'next/link';
import { WaveNewForm } from './WaveNewForm';

export const dynamic = 'force-dynamic';

async function loadEligibleSites() {
  const db = getDb();
  return db
    .select({
      id: sites.id,
      domain: sites.domain,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
      status: sites.status,
    })
    .from(sites)
    .where(inArray(sites.status, ['warming', 'live', 'rented']));
}

export default async function WaveNewPage() {
  const eligibleSites = await loadEligibleSites();

  return (
    <div className="space-y-6">
      <header>
        <nav className="text-xs text-slate-500 mb-1">
          <Link href="/operator/waves" className="hover:text-slate-300">
            Waves
          </Link>
          {' / '}
          <span>New</span>
        </nav>
        <h1 className="text-xl md:text-2xl font-semibold">New wave</h1>
        <p className="text-sm text-slate-400 mt-1">
          Name this wave, set a niche, and select 3–5 sites to launch together.
        </p>
      </header>

      <WaveNewForm sites={eligibleSites} />
    </div>
  );
}
