// A level meter (Phase 9): a bar that follows the sound, with the peak held for a moment (core/audio/meter.ts). The
// bar is for the eyes; a screen reader gets a rounded level, which only changes when the sound does.
import { fraction } from '../../../core/audio';
import type { MeterState } from '../../../core/audio';
import styles from './audio.module.css';

export function Meter({ state, label }: { state: MeterState | undefined; label: string }) {
  const bar = state ? fraction(state.barDb) : 0;
  const hold = state ? fraction(state.holdDb) : 0;
  return (
    <div
      className={styles.meter}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((bar * 100) / 10) * 10}
      data-clipped={state?.clipped || undefined}
    >
      <span className={styles.meterBar} style={{ inlineSize: `${bar * 100}%` }} />
      <span className={styles.meterHold} style={{ insetInlineStart: `${hold * 100}%` }} />
    </div>
  );
}
