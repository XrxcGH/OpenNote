// The small mark in a theme card's preview, 16 x 16: a low sun for Light, and a crescent moon with two stars for
// Dark. It is decoration inside a preview that screen readers and Tab already skip.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export function Glint({ kind, className }: ArtProps & { kind: 'sun' | 'moon' }) {
  return (
    <Art width={16} height={16} className={className}>
      {kind === 'sun' ? (
        <>
          <path className={styles.sun} d="M3.2 12.4A4.8 4.8 0 0 1 12.8 12.4Z" />
          {/* The horizon, then three rays, each from 7.8 to 9.2 out from the sun's middle, (8, 12.4), and pointing
              straight out from it: one up, and two at 50 degrees above the horizon. */}
          <path className={styles.candle} d="M1.4 12.8H14.6M8 4.6 8 3.2M3 6.4 2.1 5.3M13 6.4 13.9 5.3" />
        </>
      ) : (
        <>
          <path className={styles.moon} d="M9.6 2.6A5.6 5.6 0 1 0 13.6 11.6 4.6 4.6 0 1 1 9.6 2.6Z" />
          <circle className={styles.spark} cx="2.6" cy="3.4" r="0.9" />
          <circle className={styles.spark} cx="13.4" cy="3.8" r="0.8" />
        </>
      )}
    </Art>
  );
}
