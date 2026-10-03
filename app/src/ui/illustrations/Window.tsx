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

export type Sky = 'day' | 'night';

/** Six stars, each a zero-length stroke that the round cap turns into a dot. */
const STARS = 'M20 36h.1M37 21h.1M63 17h.1M88 47h.1M40 70h.1M66 66h.1';

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

/** The vine along the arch, and its leaves as one path: each leaf is two curves from its stem to its tip. */
const VINE = [
  'M37.5 3.8C35.9 5.2 31.7 10.2 28 12.3 24.3 14.4 18 13.6 15.4 16.4 12.9 19.2 14.6 25.5 12.7 29.3',
  '10.8 33.1 5 35.9 4.2 39.4 3.4 42.9 7.9 47.5 8.1 50.4 8.3 53.4 5.9 55.9 5.5 57',
].join(' ');
const LEAVES = [
  'M37.5 3.8Q40.5 6.7 42.4 2.9Q39.3 0 37.5 3.8Z',
  'M28 12.3Q26.7 16.7 31.2 17.4Q32.5 13 28 12.3Z',
  'M15.4 16.4Q15.5 11.9 11 12.4Q10.9 16.9 15.4 16.4Z',
  'M12.7 29.3Q16.7 31.5 18.3 27.3Q14.4 25.1 12.7 29.3Z',
  'M4.2 39.4Q8.5 38.7 7 34.7Q2.6 35.3 4.2 39.4Z',
  'M8.1 50.4Q9.5 54.6 13.3 52.3Q11.8 48.2 8.1 50.4Z',
  'M5.5 57Q2.6 60.3 6.4 62.4Q9.3 59.1 5.5 57Z',
].join('');

function Heavens({ sky }: { sky: Sky }) {
  if (sky === 'day') return <circle className={styles.sun} cx="72" cy="72" r="9.5" />;
  return (
    <>
      <path className={styles.dots} d={STARS} />
      <path className={styles.moon} d="M77 24.5A11 11 0 1 0 82 42 9 9 0 1 1 77 24.5Z" />
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
      <path fill={`url(#${gradient})`} d="M6.2 96 5.8 47C6 22.5 27 4.3 50.2 4 73.2 4.4 93.6 22 94.2 47.2L93.8 96Z" />
      <Heavens sky={sky} />
      <path
        className={sky === 'day' ? styles.fillMoss : styles.fillDusk}
        d="M7 78C20 73.5 30 80 46 76.5S72 72 93 77.5L93 95.3H7Z"
      />
      <path d="M50 4.2V96M6 56.4C30 55.6 70 57.2 94 56.2" />
      <path className={styles.moss} d={VINE} />
      <path className={`${styles.fillMoss} ${styles.moss}`} d={LEAVES} />
      <path d="M1.5 96.5H98.5V101.5H1.5Z" />
    </>
  );
}

/** The window at its drawn size, or at a given height with the same proportions. */
export function Window({ sky, className, height = 103 }: ArtProps & { sky: Sky; height?: number }) {
  return (
    <Art width={Math.round((100 * height) / 103)} height={height} box={[100, 103]} className={className}>
      <WindowArt sky={sky} />
    </Art>
  );
}
