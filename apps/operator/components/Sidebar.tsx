import { navLinks } from './navLinks';
import { DisabledNavLink, NavLink } from './NavLink';

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/40 px-4 py-6 flex flex-col gap-1 sticky top-0 h-dvh">
      <div className="px-2 mb-4">
        <h2 className="text-sm font-semibold tracking-wide text-slate-300">LeadLandlord</h2>
        <p className="text-xs text-slate-500 mt-0.5">operator</p>
      </div>
      {navLinks.map((link) =>
        link.disabled ? (
          <DisabledNavLink key={link.href} label={link.label} />
        ) : (
          <NavLink key={link.href} href={link.href} label={link.label} />
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
