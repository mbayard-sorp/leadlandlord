import { OperatorChrome } from '../../components/OperatorChrome';
import { Sidebar } from '../../components/Sidebar';

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:flex">
      <OperatorChrome />
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      <div
        id="operator-main"
        className="flex-1 min-h-dvh pl-[max(0px,env(safe-area-inset-left))] pr-[max(0px,env(safe-area-inset-right))]"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 md:py-8 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
