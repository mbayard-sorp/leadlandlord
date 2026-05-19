'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { findSiteForNiche } from './actions';

interface Props {
  nicheId: string;
  initialSiteId: string | null;
}

/**
 * For approved niches, shows a link to the in-progress site build the moment
 * site-builder inserts the sites row. Polls every 3s until the site appears,
 * then stops. If a site is already linked at render time, renders directly.
 */
export function BuildLink({ nicheId, initialSiteId }: Props) {
  const [siteId, setSiteId] = useState<string | null>(initialSiteId);

  useEffect(() => {
    if (siteId) return;
    let cancelled = false;
    const poll = async () => {
      const { siteId: found } = await findSiteForNiche(nicheId);
      if (!cancelled && found) setSiteId(found);
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [siteId, nicheId]);

  if (siteId) {
    return (
      <Link
        href={`/operator/sites/${siteId}`}
        className="inline-flex items-center gap-1 rounded border border-indigo-700 px-2 py-0.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/40"
      >
        View build →
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
      building…
    </span>
  );
}
