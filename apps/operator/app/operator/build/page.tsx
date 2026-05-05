import { BuildForm } from './BuildForm';

export const dynamic = 'force-dynamic';

export default function BuildPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Build a site</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manual niche + city kickoff. Streams live per-step progress as Site Builder runs.
        </p>
      </header>

      <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-4 text-sm text-amber-200">
        <p className="font-semibold">⚠ Local dev only (for now)</p>
        <p className="mt-1 text-amber-200/80">
          This form requires the <code className="text-amber-100">vercel</code> CLI and the
          <code className="text-amber-100 mx-1">apps/site-template/</code> source tree, neither of which
          ship in the deployed operator function. Submissions from production will fail at the
          materialize step. To use it: run the operator locally via{' '}
          <code className="text-amber-100">pnpm --filter @leadlandlord/operator dev</code>, or use{' '}
          <code className="text-amber-100">pnpm dry-run --niche "..." --city "..." --state "..."</code>
          {' '}from the repo root. Production support arrives in Phase 7 after Site Builder migrates
          to Vercel REST API for deploy.
        </p>
      </div>

      <BuildForm />
    </div>
  );
}
