// The recording indicator (Phase 9): in the title bar the whole time a recording runs, whatever page is shown. This
// part loads at start-up and draws nothing until a recording runs; the chip, with its styles, loads then.
import { lazy, Suspense } from 'react';
import { useStore } from '../../../state/store';
import { isRunning, recordingUi } from './state';

const Chip = lazy(() => import('./IndicatorChip'));

export function RecordingIndicator({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const running = useStore(recordingUi, isRunning);
  if (!running) return null;
  return (
    <Suspense fallback={null}>
      <Chip presentation={presentation} />
    </Suspense>
  );
}
