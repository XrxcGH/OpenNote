// Twenty-five stars on the evening sky, pinned to the top 160 px of the page canvas and hidden behind the page. Most
// dots are 0.75 to 1.25 px in radius at 45 to 70 percent opacity, and three larger ones, 1.7 to 1.8 px, shine at
// 75 to 80 percent. They don't twinkle. The page card starts 32 px down, so every star stays above its top edge, at
// least 5 px clear of it. The card's side edges move with the canvas width, so no star sits lower, where one could
// land on a side edge.

import styles from './illustrations.module.css';
import type { ArtProps } from './Art';

const STARS = [
  [44, 18, 1.1, 0.55],
  [131, 9, 0.9, 0.5],
  [205, 22, 1.7, 0.75],
  [262, 11, 1.1, 0.6],
  [308, 24, 0.9, 0.5],
  [352, 17, 1.25, 0.7],
  [398, 8, 0.8, 0.5],
  [418, 22, 0.9, 0.55],
  [462, 14, 1.1, 0.6],
  [507, 12, 1.1, 0.6],
  [556, 23, 0.8, 0.5],
  [611, 25, 1.25, 0.7],
  [655, 8, 1.8, 0.8],
  [703, 9, 0.8, 0.5],
  [748, 19, 1, 0.55],
  [790, 22, 1.1, 0.65],
  [836, 10, 0.9, 0.55],
  [882, 14, 1.25, 0.7],
  [947, 24, 0.9, 0.55],
  [984, 9, 1.1, 0.6],
  [1044, 13, 1.7, 0.75],
  [1088, 23, 0.75, 0.45],
  [1121, 21, 1, 0.55],
  [1203, 8, 0.9, 0.5],
  [1251, 19, 1.1, 0.55],
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
