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

      <BuildForm />
    </div>
  );
}
