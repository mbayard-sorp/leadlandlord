import { LoginForm } from './LoginForm';

interface SearchParams {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: SearchParams) {
  const { next, error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800/40 p-6">
        <h1 className="text-xl font-semibold mb-1">LeadLandlord</h1>
        <p className="text-sm text-slate-400 mb-6">Operator dashboard</p>
        {error && (
          <p className="mb-4 text-sm text-red-400">Invalid password.</p>
        )}
        <LoginForm next={next ?? '/operator'} />
      </div>
    </div>
  );
}
