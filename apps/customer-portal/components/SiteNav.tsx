/**
 * SiteNav — per-site top navigation bar rendered by both the editor and leads pages.
 *
 * Sits ABOVE the EditorShell Content/Photos tab bar. Shows:
 *   - Business name (truncated)
 *   - "Edit site" / "Leads" navigation links
 *   - Back to Dashboard link
 *   - Sign-out link
 *
 * Server component — no interactivity needed.
 */

import Link from 'next/link';

interface SiteNavProps {
  siteId: string;
  businessName: string;
  /** Which top-level section is active — controls underline indicator. */
  activeSection: 'edit' | 'leads';
}

export default function SiteNav({ siteId, businessName, activeSection }: SiteNavProps) {
  return (
    <header
      className="flex items-center justify-between px-4 py-3 border-b shrink-0 gap-4"
      style={{ background: 'var(--color-panel)', borderColor: 'var(--color-border)' }}
    >
      {/* Left: back + business name */}
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/dashboard"
          className="text-sm shrink-0"
          style={{ color: 'var(--color-accent)' }}
        >
          &larr; Dashboard
        </Link>
        <span style={{ color: 'var(--color-border)' }}>/</span>
        <span
          className="text-sm font-semibold truncate"
          style={{ color: 'var(--color-fg)' }}
        >
          {businessName}
        </span>
      </div>

      {/* Centre: Edit / Leads tabs */}
      <nav className="flex items-center gap-1 shrink-0" aria-label="Site sections">
        <Link
          href={`/sites/${siteId}/edit`}
          className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
          style={{
            color: activeSection === 'edit' ? 'var(--color-accent)' : 'var(--color-muted)',
            background: activeSection === 'edit' ? 'rgb(239 246 255)' : 'transparent',
            textDecoration: 'none',
          }}
        >
          Edit site
        </Link>
        <Link
          href={`/sites/${siteId}/leads`}
          className="px-3 py-1.5 text-xs font-medium rounded transition-colors"
          style={{
            color: activeSection === 'leads' ? 'var(--color-accent)' : 'var(--color-muted)',
            background: activeSection === 'leads' ? 'rgb(239 246 255)' : 'transparent',
            textDecoration: 'none',
          }}
        >
          Leads
        </Link>
      </nav>

      {/* Right: sign out */}
      <form action="/api/auth/sign-out" method="POST" className="shrink-0">
        <button
          type="submit"
          className="text-xs"
          style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </form>
    </header>
  );
}
