'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { navLinks } from './navLinks';
import { DisabledNavLink, NavLink } from './NavLink';

export function OperatorChrome() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const main = document.getElementById('operator-main');
    main?.setAttribute('inert', '');

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      main?.removeAttribute('inert');
      hamburgerRef.current?.focus();
    };
  }, [open, close]);

  return (
    <>
      <header
        className="md:hidden sticky top-0 z-30 bg-slate-900 border-b border-slate-800 flex items-center justify-between h-12 pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
      >
        <button
          ref={hamburgerRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="operator-drawer"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] -ml-2 rounded text-slate-200 hover:bg-slate-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="text-sm font-semibold tracking-wide text-slate-200">LeadLandlord</div>
        <span className="min-w-[44px]" aria-hidden="true" />
      </header>

      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <aside
        id="operator-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Operator navigation"
        aria-hidden={!open}
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 h-dvh bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-slate-300">LeadLandlord</h2>
            <p className="text-xs text-slate-500 mt-0.5">operator</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={close}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-slate-200 hover:bg-slate-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 flex flex-col gap-1 px-2 py-3">
          {navLinks.map((link) =>
            link.disabled ? (
              <DisabledNavLink key={link.href} label={link.label} variant="drawer" />
            ) : (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                variant="drawer"
                onNavigate={close}
              />
            ),
          )}
        </nav>
        <form action="/api/auth/logout" method="post" className="px-4 py-3 border-t border-slate-800">
          <button
            type="submit"
            className="inline-flex items-center min-h-[44px] text-sm text-slate-400 hover:text-slate-200"
          >
            Sign out
          </button>
        </form>
      </aside>
    </>
  );
}
