'use client';

import { useTransition, useState } from 'react';
import { sendInvoice, markPaid } from './actions';
import type { BuildsellSite } from '@leadlandlord/db';

interface Props {
  site: BuildsellSite;
}

export function BuildSellButtons({ site }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);

  function handleMarkPaid() {
    const fd = new FormData();
    fd.append('id', site.id);
    startTransition(async () => {
      const result = await markPaid(fd);
      setOk(result.ok);
      setMessage(result.message ?? (result.ok ? 'Marked live.' : 'Failed.'));
    });
  }

  async function handleSendInvoice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await sendInvoice(fd);
      setOk(result.ok);
      setMessage(result.message ?? (result.ok ? 'Invoice sent.' : 'Failed.'));
      if (result.ok) setShowInvoiceForm(false);
    });
  }

  if (site.status === 'live') {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-block rounded bg-emerald-900/60 px-2 py-0.5 text-xs font-medium text-emerald-300">
          Live
        </span>
        {site.slug && (
          <a
            href={`/buildsell/${site.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300 underline"
          >
            /buildsell/{site.slug}
          </a>
        )}
      </div>
    );
  }

  if (site.status === 'building' || site.status === 'failed') {
    return (
      <span className="text-xs text-slate-500">
        {site.status === 'building' ? 'Building…' : 'Build failed'}
      </span>
    );
  }

  // draft or invoiced
  return (
    <div className="space-y-2">
      {message && (
        <p className={`text-xs ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{message}</p>
      )}

      {/* Invoice form */}
      {(site.status === 'draft' || site.status === 'invoiced') && (
        <>
          {site.status === 'invoiced' && !showInvoiceForm && (
            <span className="inline-block rounded bg-blue-900/60 px-2 py-0.5 text-xs font-medium text-blue-300 mr-2">
              Invoice sent
            </span>
          )}

          {!showInvoiceForm ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => { setShowInvoiceForm(true); setMessage(null); }}
              className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
            >
              {site.status === 'invoiced' ? 'Re-send invoice' : 'Send invoice'}
            </button>
          ) : (
            <form onSubmit={handleSendInvoice} className="space-y-2 border border-slate-800 rounded p-2 bg-slate-900/40">
              <input type="hidden" name="id" value={site.id} />
              <label className="flex flex-col gap-0.5 text-xs text-slate-400">
                Price (USD)
                <input
                  name="price_usd"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={site.priceUsd ?? ''}
                  placeholder="e.g. 997"
                  className="input w-28"
                />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-slate-400">
                Payment link
                <input
                  name="payment_link"
                  type="url"
                  required
                  defaultValue={site.paymentLink ?? ''}
                  placeholder="https://..."
                  className="input w-48"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
                >
                  {pending ? '…' : 'Send'}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setShowInvoiceForm(false)}
                  className="rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* Mark paid — only available after invoice sent */}
      {site.status === 'invoiced' && !showInvoiceForm && (
        <button
          type="button"
          disabled={pending}
          onClick={handleMarkPaid}
          className="rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
        >
          {pending ? '…' : 'Mark paid'}
        </button>
      )}
    </div>
  );
}
