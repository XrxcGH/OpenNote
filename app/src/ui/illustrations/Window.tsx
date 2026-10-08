// An arched window, 100 x 103: a sunset sky by day, and stars with a crescent moon in the evening. The sill and the
// panes are lines. The sky is a soft gradient from the tints. By day, paper light turns to a candle and dusk band
// at the hills. In the evening, deep night lightens to indigo at the horizon.
//
// The hills, the sun, and the moon are flat fills from the tokens, and the stars are dots. A moss vine twines in
// and out of the frame down the left of the arch, with seven small leaves.

import { useId } from 'react';
import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';
import { WINDOW } from './shapes';

export type Sky = 'day' | 'night';

/** The sky's color stops, top to bottom: the sunset band sits behind the sun, and the night lightens at the hills. */
const STOPS = {
  day: [
    [0, styles.stopPaper],
    [0.35, styles.stopPaper],
    [0.6, styles.stopCandle],
    [0.85, styles.stopDusk],
  ],
  night: [
    [0, styles.stopDeep],
    [0.45, styles.stopDeep],
    [0.9, styles.stopNight],
  ],
} as const;

/** The leaves are one path: each leaf is two curves from its stem to its tip. */
const LEAVES = WINDOW.leaves.join('');

function Heavens({ sky }: { sky: Sky }) {
  if (sky === 'day') return <circle className={styles.sun} {...WINDOW.sun} />;
  return (
    <>
      <path className={styles.dots} d={WINDOW.stars} />
      <path className={styles.moon} d={WINDOW.moon} />
    </>
  );
}

export function WindowArt({ sky }: { sky: Sky }) {
  const gradient = useId();
  return (
    <>
      <defs>
        <linearGradient id={gradient} x2="0" y2="1">
          {STOPS[sky].map(([offset, className]) => (
            <stop key={offset} offset={offset} className={className} />
          ))}
        </linearGradient>
      </defs>
      <path fill={`url(#${gradient})`} d={WINDOW.sky} />
      <Heavens sky={sky} />
      <path className={sky === 'day' ? styles.fillMoss : styles.fillDusk} d={WINDOW.hills} />
      <path d={WINDOW.bars} />
      <path className={styles.moss} d={WINDOW.vine} />
      <path className={`${styles.fillMoss} ${styles.moss}`} d={LEAVES} />
      <path d={WINDOW.sill} />
    </>
  );
}

/** The window at its drawn size, or at a given height with the same proportions. */
export function Window({ sky, className, height = 103 }: ArtProps & { sky: Sky; height?: number }) {
  return (
    <Art width={Math.round((100 * height) / 103)} height={height} box={WINDOW.box} className={className}>
      <WindowArt sky={sky} />
    </Art>
  );
}
