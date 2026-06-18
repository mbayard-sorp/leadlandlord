'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteSite } from './actions';

interface Props {
  siteId: string;
  /** Human label shown in the confirm prompt, e.g. "tree-removal — Tucson, AZ". */
  label: string;
  /** Tenants still attached (non-churned). When > 0 the delete is blocked up front. */
  liveTenantCount: number;
}

/**
 * Danger zone — permanently delete a site and all its content.
 *
 * Two-step guard: reveal the panel, then type the confirm phrase. The server
 * action re-checks for live tenants, so the disabled state here is just UX.
 */
export function DeleteSitePanel({ siteId, label, liveTenantCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const blocked = liveTenantCount > 0;
  const canDelete = armed && typed.trim().toLowerCase() === 'delete' && !pending && !blocked;

  function onDelete() {
    setMsg(null);
    setWarnings([]);
    startTransition(async () => {
      const r = await deleteSite(siteId);
      if (r.ok) {
        // Row is gone — bounce to the portfolio. (If there were cleanup
        // warnings, the operator will still see them on the destination via
        // logs; we redirect because this page would 404 on refresh.)
        router.push('/operator/portfolio');
        router.refresh();
        return;
      }
      setMsg(r.message ?? 'delete failed');
      setWarnings(r.warnings ?? []);
    });
  }

  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-5 space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-red-200">Delete site</h3>
        <p className="text-xs text-red-300/70 mt-1">
          Permanently removes the database row (calls, leads, prospects, trials,
          backlinks) and every Sanity doc (site, pages, keyword clusters),
          releases the Twilio number, and detaches custom domains.
          This cannot be undone.
        </p>
      </header>

      {blocked && (
        <p className="text-xs text-amber-300 rounded border border-amber-800/60 bg-amber-950/30 p-2">
          {liveTenantCount} live tenant(s) attached. Off-board the tenant and
          cancel their Stripe subscription before this site can be deleted.
        </p>
      )}

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          disabled={blocked}
          className="px-3 py-2 rounded border border-red-800 bg-red-950/40 text-red-200 text-sm hover:bg-red-900/40 disabled:opacity-50"
        >
          Delete this site…
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-red-300/80">
            Type <span className="font-mono font-semibold">delete</span> to confirm removal of{' '}
            <span className="font-semibold">{label}</span>:
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              placeholder="delete"
              className="px-3 py-2 rounded border border-red-800 bg-slate-950/60 text-slate-100 text-sm font-mono w-40 focus:outline-none focus:border-red-500"
            />
            <button
              type="button"
              onClick={onDelete}
              disabled={!canDelete}
              className="px-3 py-2 rounded border border-red-700 bg-red-800/60 text-red-50 text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? 'Deleting…' : 'Permanently delete'}
            </button>
            <button
              type="button"
              onClick={() => {
                setArmed(false);
                setTyped('');
                setMsg(null);
              }}
              disabled={pending}
              className="px-3 py-2 rounded border border-slate-700 bg-slate-900/60 text-slate-300 text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-red-300">{msg}</p>}
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-300/80 list-disc pl-5 space-y-0.5">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
