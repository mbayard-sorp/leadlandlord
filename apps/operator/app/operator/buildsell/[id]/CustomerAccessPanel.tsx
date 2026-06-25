'use client';

import { useState, useTransition } from 'react';
import { grantAccess, revokeAccess } from './customer-access-actions';
import type { AccessRow } from './customer-access-actions';

interface Props {
  siteId: string;
  initialRows: AccessRow[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Operator panel for managing B&S customer portal access grants.
 *
 * Lists current access rows for the site (active and revoked), lets the
 * operator grant access to a new email (provisions a Neon Auth user + access
 * row), and lets the operator revoke active rows.
 *
 * Server actions: grantAccess, revokeAccess (in customer-access-actions.ts).
 */
export function CustomerAccessPanel({ siteId, initialRows }: Props) {
  const [rows, setRows] = useState<AccessRow[]>(initialRows);
  const [grantMsg, setGrantMsg] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleGrant(formData: FormData) {
    setGrantMsg(null);
    startTransition(async () => {
      const result = await grantAccess(formData);
      if (result.ok) {
        setGrantMsg(result.message ?? 'Access granted.');
        // Re-fetch by reloading — revalidatePath on the server will refresh the
        // server component; optimistically just indicate success here.
      } else {
        setGrantMsg(`Error: ${result.message}`);
      }
    });
  }

  function handleRevoke(accessRowId: string) {
    setRevokeMsg(null);
    const fd = new FormData();
    fd.set('access_row_id', accessRowId);
    fd.set('site_id', siteId);
    startTransition(async () => {
      const result = await revokeAccess(fd);
      if (result.ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === accessRowId
              ? { ...r, revokedAt: new Date().toISOString() }
              : r,
          ),
        );
        setRevokeMsg(result.message ?? 'Revoked.');
      } else {
        setRevokeMsg(`Error: ${result.message}`);
      }
    });
  }

  const activeRows  = rows.filter((r) => !r.revokedAt);
  const revokedRows = rows.filter((r) => r.revokedAt);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold text-slate-300">Customer Portal Access</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Grant portal access to let the business owner edit their site content.
        </p>
      </header>

      {/* Grant form */}
      <form
        action={handleGrant}
        className="flex flex-wrap gap-2 items-end"
      >
        <input type="hidden" name="site_id" value={siteId} />
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label htmlFor="cp-email" className="text-xs text-slate-400">
            Customer email
          </label>
          <input
            id="cp-email"
            name="email"
            type="email"
            required
            placeholder="owner@example.com"
            className="bg-slate-700/60 border border-slate-600/60 rounded px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 shrink-0"
        >
          {isPending ? 'Granting…' : 'Grant access'}
        </button>
      </form>

      {grantMsg && (
        <p className={`text-xs ${grantMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
          {grantMsg}
        </p>
      )}

      {revokeMsg && (
        <p className={`text-xs ${revokeMsg.startsWith('Error') ? 'text-red-400' : 'text-amber-400'}`}>
          {revokeMsg}
        </p>
      )}

      {/* Active rows */}
      {activeRows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
            Active ({activeRows.length})
          </p>
          <ul className="space-y-1">
            {activeRows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded bg-slate-800/60 border border-slate-700/40 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-slate-200 font-mono truncate">{row.authUserId}</p>
                  <p className="text-slate-500">
                    Granted {formatDate(row.grantedAt)} &middot; by{' '}
                    <span className="text-slate-400">{row.grantedBy}</span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleRevoke(row.id)}
                  className="shrink-0 px-2 py-1 rounded text-xs bg-red-900/50 hover:bg-red-800/60 text-red-300 disabled:opacity-40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No active access grants.</p>
      )}

      {/* Revoked rows (collapsed, audit trail) */}
      {revokedRows.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-400 select-none">
            Revoked ({revokedRows.length})
          </summary>
          <ul className="mt-2 space-y-1 pl-2 border-l border-slate-700/40">
            {revokedRows.map((row) => (
              <li key={row.id} className="text-slate-600 space-y-0.5">
                <p className="font-mono">{row.authUserId}</p>
                <p>
                  Granted {formatDate(row.grantedAt)} &middot; Revoked{' '}
                  {row.revokedAt ? formatDate(row.revokedAt) : '—'}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
