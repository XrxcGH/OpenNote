// The indicator's chip (Phase 9): a red dot, the recorded time, and a button that opens the controls. BRAND.md: the
// dot pulses slowly, and the pulse stops when motion is reduced.
import { lazy, Suspense, useRef, useState } from 'react';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Popover } from '../../../ui';
import styles from './audio.module.css';
import { clock } from './format';
import { isRunning, recordingUi } from './state';

const Panel = lazy(() => import('./IndicatorPanel'));

export default function IndicatorChip({ presentation }: { presentation: 'full' | 'icon' | 'menuItem' }) {
  const ui = useStore(recordingUi, (state) => state);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!isRunning(ui)) return null;
  const paused = ui.phase === 'paused';
  const text = t(paused ? 'audio.indicator.paused' : 'audio.indicator.recording', { time: clock(ui.elapsedMs) });
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('audio.indicator.label', { state: text })}
        data-testid="recording-indicator"
        onClick={() => setOpen((shown) => !shown)}
      >
        <span className={styles.dot} data-live={!paused} aria-hidden="true" />
        {presentation !== 'icon' && <span>{text}</span>}
      </button>
      <Popover anchor={anchor} label={t('audio.indicator.title')} open={open} onClose={() => setOpen(false)}>
        <Suspense fallback={null}>
          <Panel onClose={() => setOpen(false)} />
        </Suspense>
      </Popover>
    </>
  );
}
