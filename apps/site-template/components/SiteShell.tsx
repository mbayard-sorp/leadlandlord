import type { ReactNode } from 'react';
import { trackingNumber } from '../lib/content';

interface Props {
  children: ReactNode;
  businessName: string;
  niche: string;
  city: string;
  state: string;
  navServices: { slug: string; title: string }[];
  navAreas: { slug: string; title: string }[];
}

export function SiteShell({
  children,
  businessName,
  niche,
  city,
  state,
  navServices,
  navAreas,
}: Props) {
  const phone = trackingNumber();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <a href="/" className="font-semibold text-lg">
            {businessName}
          </a>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            {navServices.slice(0, 4).map((s) => (
              <a key={s.slug} href={s.slug} className="text-slate-700 hover:text-slate-900">
                {s.title}
              </a>
            ))}
            <a href="/about/" className="text-slate-700 hover:text-slate-900">
              About
            </a>
            <a href="/contact/" className="text-slate-700 hover:text-slate-900">
              Contact
            </a>
            <a
              href={`tel:${phone.replace(/[^+\d]/g, '')}`}
              className="rounded bg-blue-700 text-white px-3 py-1.5 font-medium hover:bg-blue-800"
            >
              {phone}
            </a>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto px-4 py-10 prose prose-slate">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4 py-6 text-xs text-slate-500 space-y-2">
          <p>
            <strong>{businessName}</strong> — {niche} in {city}, {state}. Call {phone} or use the
            form on any page to request a quote.
          </p>
          <p>
            This site connects callers with a partnered local provider. Phone numbers are
            answered during business hours.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {navAreas.slice(0, 6).map((a) => (
              <a key={a.slug} href={a.slug} className="hover:underline">
                {a.title}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
