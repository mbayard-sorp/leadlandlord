import { desc, getDb, autoApproveRules } from '@leadlandlord/db';
import Link from 'next/link';
import { DeactivateRuleButton, CreateRuleForm } from '../RuleButtons';

export const dynamic = 'force-dynamic';

type RuleRow = typeof autoApproveRules.$inferSelect;

export default async function AutoApproveRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; score_gte?: string }>;
}) {
  const { kind: prefillKind, score_gte } = await searchParams;

  const db = getDb();
  const rules: RuleRow[] = await db
    .select()
    .from(autoApproveRules)
    .orderBy(desc(autoApproveRules.createdAt));

  const active = rules.filter((r) => r.active);
  const inactive = rules.filter((r) => !r.active);

  const prefillMatcher =
    prefillKind && score_gte
      ? JSON.stringify({ score: { $gte: Number(score_gte) } }, null, 2)
      : '{\n  "score": { "$gte": 70 }\n}';

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">Auto-approve rules</h1>
          <Link
            href="/operator/approvals"
            className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 px-2 py-0.5 rounded"
          >
            Approvals inbox
          </Link>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Rules that auto-approve matching agent approval requests. Predicates are evaluated
          against the approval payload using dot-path keys and operator objects.
        </p>
        <div className="mt-2 text-xs text-slate-500 font-mono bg-slate-900 rounded p-2 w-fit">
          Supported: {'{ "$gte": n }'} {'{ "$lte": n }'} {'{ "$eq": val }'} {'{ "$includes": str }'}
        </div>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300 mb-3">
          New rule
        </h2>
        <CreateRuleForm
          prefillKind={prefillKind ?? 'niche_candidate'}
          prefillMatcher={prefillMatcher}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300 mb-2">
          Active rules ({active.length})
        </h2>
        {active.length === 0 ? (
          <Empty>No active rules.</Empty>
        ) : (
          <RulesTable rules={active} showDeactivate />
        )}
      </section>

      {inactive.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Inactive rules ({inactive.length})
          </h2>
          <RulesTable rules={inactive} showDeactivate={false} />
        </section>
      )}
    </div>
  );
}

function RulesTable({
  rules,
  showDeactivate,
}: {
  rules: RuleRow[];
  showDeactivate: boolean;
}) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <Th>Kind</Th>
            <Th>Matcher</Th>
            <Th>Approved</Th>
            <Th>Created</Th>
            {showDeactivate && <Th>Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
              <Td>
                <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                  {r.kind}
                </span>
              </Td>
              <Td>
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap max-w-xs">
                  {JSON.stringify(r.matcher, null, 2)}
                </pre>
              </Td>
              <Td className="text-slate-400">{r.approvedCount}</Td>
              <Td className="text-slate-500 whitespace-nowrap text-xs">
                {new Date(r.createdAt).toLocaleDateString()}
              </Td>
              {showDeactivate && (
                <Td>
                  <DeactivateRuleButton id={r.id} />
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-500">
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
