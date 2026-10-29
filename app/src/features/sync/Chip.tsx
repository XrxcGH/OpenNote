// The sync notice in the title bar, at start-up weight: it reads the state once a minute after sync is set up, and
// draws nothing while sync is off. The part that draws (ChipBody.tsx, with its styles) loads the first time it shows.

import { lazy, Suspense } from 'react';
import { useFlag } from '../../app/flags';
import type { SyncView } from './types';
import { useSyncPolling, useSyncView } from './runtime';

const Body = lazy(() => import('./ChipBody'));

const shows = (on: boolean, view: SyncView | null): view is SyncView =>
  on && !!view?.configured && view.status.state !== 'off';

/** Whether the notice shows. The bar calls it for the item's slot, so it also keeps the state fresh there. */
export function useSyncChipVisible(): boolean {
  const on = useFlag('sync.e2ee');
  useSyncPolling(60_000, on);
  return shows(on, useSyncView());
}

export function SyncChip({ presentation }: { presentation?: 'full' | 'icon' | 'menuItem' }) {
  const on = useFlag('sync.e2ee');
  // In More the bar has no slot for the item, so the notice keeps the state fresh itself.
  useSyncPolling(60_000, on && presentation === 'menuItem');
  const view = useSyncView();
  if (!shows(on, view)) return null;
  return (
    <Suspense fallback={null}>
      <Body view={view} iconOnly={presentation === 'icon'} />
    </Suspense>
  );
}
