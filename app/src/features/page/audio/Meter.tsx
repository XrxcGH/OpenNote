// A level meter (Phase 9): a bar that follows the sound, with the peak held for a moment (core/audio/meter.ts). The
// bar is for the eyes; a screen reader gets a rounded level, which only changes when the sound does.
import { useState } from 'react';
import { fraction } from '../../../core/audio';
import type { MeterState } from '../../../core/audio';
import styles from './audio.module.css';
import blockStyles from './block.module.css';

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

/** How many readings the live wave shows. At the poll rate, this is the last few seconds of sound. */
export const WAVE_BARS = 48;

/**
 * The last few seconds of level, drawn as bars that move across as the sound comes in. A silent microphone shows a flat
 * row of dots and speech shows hills, so a person can see the sound is being heard. The meter above it is what a
 * screen reader gets, so this is hidden from them.
 */
export function Wave({ state }: { state: MeterState | undefined }) {
  const [wave, setWave] = useState<{ seen: MeterState | undefined; bars: number[] }>(() => ({
    seen: undefined,
    bars: Array.from({ length: WAVE_BARS }, () => 0),
  }));
  // Each new reading pushes the row along. It is worked out while rendering, from the reading last seen, so no extra
  // render follows it.
  if (state && state !== wave.seen) setWave({ seen: state, bars: [...wave.bars.slice(1), fraction(state.barDb)] });
  const bars = wave.bars;
  return (
    <svg
      className={blockStyles.wave}
      viewBox={`0 0 ${WAVE_BARS} 1`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="recording-wave"
      data-clipped={state?.clipped || undefined}
    >
      {bars.map((bar, at) => {
        const height = Math.max(bar, 0.06);
        return <rect key={at} x={at + 0.15} y={(1 - height) / 2} width={0.7} height={height} data-level={bar} />;
      })}
    </svg>
  );
}
