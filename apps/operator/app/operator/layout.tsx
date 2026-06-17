import { getSystemState } from '@leadlandlord/db';
import { OperatorChrome } from '../../components/OperatorChrome';
import { Sidebar } from '../../components/Sidebar';
import { OperatorTimeZoneProvider } from '../../components/Timestamp';
import { DEFAULT_TIME_ZONE } from '../../lib/format-date';

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  // Read the configured display zone once for the whole operator subtree. Tolerate
  // DB hiccups: the chrome should still render (in UTC) if state is unreachable.
  let timeZone = DEFAULT_TIME_ZONE;
  try {
    timeZone = (await getSystemState()).operatorTimeZone;
  } catch {
    // fall back to DEFAULT_TIME_ZONE
  }

  return (
    <OperatorTimeZoneProvider timeZone={timeZone}>
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
    </OperatorTimeZoneProvider>
  );
}
