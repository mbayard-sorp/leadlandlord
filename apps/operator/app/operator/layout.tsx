import { Sidebar } from '../../components/Sidebar';

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 min-h-screen">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </div>
    </div>
  );
}
