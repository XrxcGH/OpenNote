// The sync notice in the title bar, at start-up weight: it reads the state once a minute after sync is set up, and
// draws nothing while sync is off. The part that draws (ChipBody.tsx, with its styles) loads the first time it shows.

import { lazy, Suspense } from 'react';
import { useFlag } from '../../app/flags';
import { useSyncPolling, useSyncView } from './runtime';

const Body = lazy(() => import('./ChipBody'));

export function SyncChip({ presentation }: { presentation?: 'full' | 'icon' | 'menuItem' }) {
  const on = useFlag('sync.e2ee');
  useSyncPolling(60_000, on);
  const view = useSyncView();
  if (!on || !view?.configured || view.status.state === 'off') return null;
  return (
    <Suspense fallback={null}>
      <Body view={view} iconOnly={presentation === 'icon'} />
    </Suspense>
  );
}
