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
          <path className={styles.candle} d="M1.4 12.8H14.6M8 3.2V4.6M3 5.6l1 1M13 5.6l-1 1" />
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
