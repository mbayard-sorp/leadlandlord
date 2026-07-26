'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { CustomSiteNavLink } from '@/lib/customsites-sanity';

/** Active-link underline via usePathname — the one bit of the header that
 * genuinely needs client interactivity (Server Components can't read the
 * current route). Kept as a tiny presentational wrapper, not a data fetch. */
export function NavLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const isActive = href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <a href={href} className={className} aria-current={isActive ? 'page' : undefined}>
      {children}
    </a>
  );
}

interface MobileDrawerProps {
  links: CustomSiteNavLink[];
  phone?: string | null;
}

/**
 * Mobile hamburger + slide-in drawer. Locks body scroll while open, closes on
 * Escape or overlay click. The trigger button lives in the (server) header;
 * this component owns open state and renders the toggle + drawer together so
 * `aria-expanded`/`aria-controls` stay in sync without prop drilling state
 * back up to a server component.
 */
export function MobileDrawer({ links, phone }: MobileDrawerProps) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog on open — without this, keyboard/SR users
    // stay parked on the (now visually covered) toggle button.
    closeButtonRef.current?.focus();

    function getFocusable(): HTMLElement[] {
      if (!drawerRef.current) return [];
      return Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab/Shift+Tab inside the dialog so focus never leaks to the
      // (visually hidden behind the overlay) rest of the page.
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      // Runs on every close path (Escape, overlay click, close button, link
      // click, unmount) — hand focus back to the control that opened us.
      toggleRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={toggleRef}
        className="cs-nav-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="cs-mobile-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cs-nav-toggle-bar" />
        <span className="cs-nav-toggle-bar" />
        <span className="cs-nav-toggle-bar" />
      </button>

      {open ? (
        <>
          <div className="cs-drawer-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            id="cs-mobile-drawer"
            ref={drawerRef}
            className="cs-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Site menu"
          >
            <button
              type="button"
              ref={closeButtonRef}
              className="cs-drawer-close"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              &times;
            </button>
            {phone ? (
              <a href={`tel:${phone}`} className="cs-btn cs-btn-primary" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
                Call {phone}
              </a>
            ) : null}
            <ul className="cs-drawer-links">
              {links.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <a href={link.href ?? '#'} onClick={() => setOpen(false)}>
                    {link.label}
                  </a>
                  {link.children && link.children.length > 0 ? (
                    <ul className="cs-drawer-sublinks">
                      {link.children.map((child) => (
                        <li key={`${child.label}-${child.href}`}>
                          <a href={child.href ?? '#'} onClick={() => setOpen(false)}>
                            {child.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </>
  );
}
