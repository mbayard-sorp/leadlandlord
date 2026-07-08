'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sub-nav for the Build & Sell section. The lead-search index and the
 * portfolio dashboard share the same top-level nav entry, so this tab bar
 * switches between them. Both pages render it directly under their header.
 */
const tabs = [
  { href: '/operator/buildsell', label: 'Leads & Sites' },
  { href: '/operator/buildsell/portfolio', label: 'Portfolio' },
] as const;

export function BuildSellTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 border-b border-slate-800 -mb-px">
      {tabs.map((tab) => {
        // Exact match only — /operator/buildsell must not stay active on the
        // /operator/buildsell/portfolio sub-route (it's a prefix of it).
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`px-1 pb-2 text-sm transition-colors ${
              isActive
                ? 'text-slate-100 border-b-2 border-sky-400'
                : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
