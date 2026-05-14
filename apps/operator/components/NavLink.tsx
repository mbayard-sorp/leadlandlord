'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavLinkProps = {
  href: string;
  label: string;
  variant?: 'sidebar' | 'drawer';
  onNavigate?: () => void;
};

export function NavLink({ href, label, variant = 'sidebar', onNavigate }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== '/operator' && pathname.startsWith(href + '/'));

  const base =
    variant === 'drawer'
      ? 'flex items-center min-h-[44px] px-4 text-sm rounded'
      : 'text-sm px-2 py-1.5 rounded';

  const tone = isActive
    ? 'bg-slate-800 text-white'
    : 'text-slate-200 hover:bg-slate-800 hover:text-white';

  return (
    <Link
      href={href}
      className={`${base} ${tone}`}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}

export function DisabledNavLink({
  label,
  variant = 'sidebar',
}: {
  label: string;
  variant?: 'sidebar' | 'drawer';
}) {
  const base =
    variant === 'drawer'
      ? 'flex items-center min-h-[44px] px-4 text-sm text-slate-600 cursor-not-allowed'
      : 'text-sm px-2 py-1.5 text-slate-600 cursor-not-allowed';
  return (
    <span className={base} title="Coming in Phase 2+">
      {label}
    </span>
  );
}
