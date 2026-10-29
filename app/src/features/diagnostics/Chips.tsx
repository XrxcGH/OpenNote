// The two title bar notices at start-up weight: each reads one store and draws nothing unless its state is on. The
// part that draws (StatusChips.tsx, with its popover, text, and styles) loads the first time a notice shows.

import { lazy, Suspense } from 'react';
import { useOffline, useSafeMode } from './runtime';

const OfflineBody = lazy(() => import('./StatusChips').then((module) => ({ default: module.OfflineChip })));
const SafeModeBody = lazy(() => import('./StatusChips').then((module) => ({ default: module.SafeModeChip })));

/** In the title bar's More menu a notice is drawn open in the list: a popover opened from inside it would close with it. */
interface Presentation {
  presentation?: 'full' | 'icon' | 'menuItem';
}

/** "Working offline", while Work offline is on. */
export function OfflineChip({ presentation }: Presentation) {
  const offline = useOffline();
  return offline ? (
    <Suspense fallback={null}>
      <OfflineBody inline={presentation === 'menuItem'} />
    </Suspense>
  ) : null;
}

/** "OpenNote is in safe mode", for the rest of a session that started in safe mode. */
export function SafeModeChip({ presentation }: Presentation) {
  const safe = useSafeMode();
  return safe ? (
    <Suspense fallback={null}>
      <SafeModeBody inline={presentation === 'menuItem'} />
    </Suspense>
  ) : null;
}
