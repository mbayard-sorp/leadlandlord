import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getDb,
  tenants,
  sites,
  calls,
  agentApprovals,
  eq,
  desc,
  sql,
} from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

function formatDate(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function TenantStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'trial'
      ? 'bg-sky-900/40 text-sky-300 border-sky-700/50'
      : status === 'past_due'
      ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
      : 'bg-rose-900/40 text-rose-300 border-rose-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select({
      id: tenants.id,
      businessName: tenants.businessName,
      contactName: tenants.contactName,
      phone: tenants.phone,
      email: tenants.email,
      status: tenants.status,
      monthlyRentUsd: tenants.monthlyRentUsd,
      stripeCustomerId: tenants.stripeCustomerId,
      stripeSubId: tenants.stripeSubId,
      startedAt: tenants.startedAt,
      churnedAt: tenants.churnedAt,
      churnReason: tenants.churnReason,
      siteId: tenants.siteId,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
    })
    .from(tenants)
    .leftJoin(sites, eq(tenants.siteId, sites.id))
    .where(eq(tenants.id, id))
    .limit(1);

  if (!row) notFound();

  const [recentCalls, dunningRows] = await Promise.all([
    db
      .select()
      .from(calls)
      .where(eq(calls.tenantId, id))
      .orderBy(desc(calls.startedAt))
      .limit(10),
    db
      .select()
      .from(agentApprovals)
      .where(
        sql`${agentApprovals.kind} = 'dunning_action' AND ${agentApprovals.payload}->>'tenant_id' = ${id}`,
      )
      .orderBy(desc(agentApprovals.createdAt)),
  ]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold">{row.businessName}</h1>
            <TenantStatusBadge status={row.status} />
          </div>
          {(row.contactName || row.phone || row.email) && (
            <p className="text-sm text-slate-400 mt-1">
              {[row.contactName, row.phone, row.email].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-0.5">
            {row.niche ?? '—'}{row.city ? ` / ${row.city}` : ''}
          </p>
        </div>
        <Link
          href="/operator/tenants"
          className="text-sm text-slate-400 hover:text-slate-200 shrink-0"
        >
          ← All tenants
        </Link>
      </div>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Billing</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <BillingRow label="MRR" value={row.monthlyRentUsd ? currency.format(Number(row.monthlyRentUsd)) : '—'} />
          <BillingRow label="Started" value={formatDate(row.startedAt)} />
          {row.churnedAt && <BillingRow label="Churned" value={formatDate(row.churnedAt)} />}
          {row.churnReason && <BillingRow label="Churn reason" value={row.churnReason} />}
          {row.stripeCustomerId && (
            <BillingRow label="Stripe customer" value={row.stripeCustomerId} mono />
          )}
          {row.stripeSubId && (
            <BillingRow label="Stripe sub" value={row.stripeSubId} mono />
          )}
          {row.siteId && (
            <div className="col-span-2 flex items-center gap-2">
              <span className="text-slate-500">Site</span>
              <Link
                href={`/operator/sites/${row.siteId}`}
                className="text-sky-400 hover:text-sky-300 font-mono text-xs"
              >
                {row.siteId}
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Recent calls</h2>
        {recentCalls.length === 0 ? (
          <p className="text-sm text-slate-500">No calls recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th>Classification</Th>
                  <Th>Est revenue</Th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c) => (
                  <tr key={c.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="text-slate-400 text-xs whitespace-nowrap">
                      {formatDate(c.startedAt)}
                    </Td>
                    <Td className="text-slate-400 text-xs">
                      {c.durationS != null ? `${c.durationS}s` : '—'}
                    </Td>
                    <Td>
                      <span className="text-xs bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                        {c.classification}
                      </span>
                    </Td>
                    <Td className="text-slate-300 text-xs">
                      {c.estRevenueUsd ? currency.format(Number(c.estRevenueUsd)) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Dunning history</h2>
        {dunningRows.length === 0 ? (
          <p className="text-sm text-slate-500">No dunning actions recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <Th>Created</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                  <Th>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {dunningRows.map((a) => {
                  const p = a.payload as Record<string, unknown>;
                  return (
                    <tr key={a.id} className="border-b border-slate-800/60 last:border-0">
                      <Td className="text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(a.createdAt)}
                      </Td>
                      <Td>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded border ${
                            a.status === 'approved' || a.status === 'auto_approved'
                              ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
                              : a.status === 'rejected'
                              ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
                              : 'bg-slate-800/60 text-slate-400 border-slate-700'
                          }`}
                        >
                          {a.status}
                        </span>
                      </Td>
                      <Td className="text-slate-300 text-xs font-medium">
                        {typeof p.action === 'string' ? p.action : '—'}
                      </Td>
                      <Td className="text-slate-400 text-xs">
                        {typeof p.amount_usd === 'number'
                          ? currency.format(p.amount_usd)
                          : typeof p.amount_usd === 'string'
                          ? currency.format(Number(p.amount_usd))
                          : '—'}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function BillingRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-500 shrink-0 w-32">{label}</span>
      <span className={`text-slate-300 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium text-left">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
