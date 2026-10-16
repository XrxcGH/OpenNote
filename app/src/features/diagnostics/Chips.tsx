// The two title bar notices at start-up weight: each reads one store and draws nothing unless its state is on. The
// part that draws (StatusChips.tsx, with its popover, text, and styles) loads the first time a notice shows.

import { lazy, Suspense } from 'react';
import { useOffline, useSafeMode } from './runtime';

const OfflineBody = lazy(() => import('./StatusChips').then((module) => ({ default: module.OfflineChip })));
const SafeModeBody = lazy(() => import('./StatusChips').then((module) => ({ default: module.SafeModeChip })));

/** "Working offline", while Work offline is on. */
export function OfflineChip() {
  const offline = useOffline();
  return offline ? (
    <Suspense fallback={null}>
      <OfflineBody />
    </Suspense>
  ) : null;
}

/** "OpenNote is in safe mode", for the rest of a session that started in safe mode. */
export function SafeModeChip() {
  const safe = useSafeMode();
  return safe ? (
    <Suspense fallback={null}>
      <SafeModeBody />
    </Suspense>
  ) : null;
}
