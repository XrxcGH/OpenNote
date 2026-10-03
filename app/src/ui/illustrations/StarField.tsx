// Twelve stars on the evening sky, pinned to the top 160 px of the page canvas and hidden behind the page. The dots
// are 0.75 to 1.25 px in radius at 35 to 60 percent opacity. They don't twinkle.

import styles from './illustrations.module.css';
import type { ArtProps } from './Art';

const STARS = [
  [291, 52, 1.1, 0.5],
  [313, 120, 0.9, 0.4],
  [352, 17, 1.25, 0.6],
  [418, 31, 0.9, 0.45],
  [507, 12, 1.1, 0.5],
  [611, 25, 1.25, 0.6],
  [703, 9, 0.8, 0.4],
  [790, 28, 1.1, 0.55],
  [882, 14, 1.25, 0.6],
  [947, 33, 0.9, 0.45],
  [976, 88, 1.1, 0.5],
  [990, 142, 0.75, 0.35],
] as const;

export function StarField({ className }: ArtProps) {
  return (
    <svg
      className={className ? `${styles.stars} ${className}` : styles.stars}
      viewBox="0 0 1280 160"
      preserveAspectRatio="xMidYMin slice"
      aria-hidden="true"
      focusable="false"
    >
      {STARS.map(([x, y, r, opacity]) => (
        <circle key={x} cx={x} cy={y} r={r} opacity={opacity} />
      ))}
    </svg>
  );
}
