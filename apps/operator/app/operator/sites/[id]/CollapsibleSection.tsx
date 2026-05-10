/**
 * CollapsibleSection — thin wrapper around native <details>/<summary>.
 * The browser manages open/close state — no React state needed.
 * Collapsed by default (no `open` attribute on <details>).
 */
interface Props {
  title: string;
  children: React.ReactNode;
  /** If true, renders the section initially open. Default: false (collapsed). */
  defaultOpen?: boolean;
}

export function CollapsibleSection({ title, children, defaultOpen = false }: Props) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group rounded-lg border border-slate-800 bg-slate-900/40"
    >
      <summary className="flex items-center justify-between px-5 py-4 cursor-pointer select-none list-none hover:bg-slate-900/60 rounded-lg">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {/* Chevron rotates when open via group-open Tailwind variant */}
        <span
          className="text-slate-500 transition-transform duration-150 group-open:rotate-180"
          aria-hidden
        >
          ▾
        </span>
      </summary>
      <div className="px-5 pb-5 pt-2">{children}</div>
    </details>
  );
}
