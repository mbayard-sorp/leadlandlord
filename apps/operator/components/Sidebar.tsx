import Link from 'next/link';

const links = [
  { href: '/operator', label: 'Overview' },
  { href: '/operator/portfolio', label: 'Portfolio' },
  { href: '/operator/build', label: 'Build site' },
  { href: '/operator/calls', label: 'Calls' },
  { href: '/operator/agents', label: 'Agents' },
  { href: '/operator/pipeline', label: 'Pipeline', disabled: true },
  { href: '/operator/tenants', label: 'Tenants', disabled: true },
  { href: '/operator/niches', label: 'Niche Library', disabled: true },
  { href: '/operator/pnl', label: 'P&L', disabled: true },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/40 px-4 py-6 flex flex-col gap-1 sticky top-0 h-screen">
      <div className="px-2 mb-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-300">LeadLandlord</h2>
        <p className="text-xs text-slate-500 mt-0.5">operator</p>
      </div>
      {links.map((link) =>
        link.disabled ? (
          <span
            key={link.href}
            className="text-sm px-2 py-1.5 text-slate-600 cursor-not-allowed"
            title="Coming in Phase 2+"
          >
            {link.label}
          </span>
        ) : (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm px-2 py-1.5 rounded text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            {link.label}
          </Link>
        ),
      )}
      <form action="/api/auth/logout" method="post" className="mt-auto pt-4 border-t border-slate-800">
        <button type="submit" className="text-xs text-slate-500 hover:text-slate-300">
          Sign out
        </button>
      </form>
    </aside>
  );
}
