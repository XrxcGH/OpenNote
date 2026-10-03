// An arched window, 100 x 102: a sunset sky by day, and stars with a crescent moon in the evening. The sill and the
// panes are lines. The sky, the dusk hills, the sun, and the moon are flat fills from the tokens, and the stars
// are dots.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export type Sky = 'day' | 'night';

/** Six stars, each a zero-length stroke that the round cap turns into a dot. */
const STARS = 'M22 40h.1M37 21h.1M63 17h.1M84 37h.1M17 67h.1M66 66h.1';

function Heavens({ sky }: { sky: Sky }) {
  if (sky === 'day') return <circle className={styles.sun} cx="72" cy="68" r="9.5" />;
  return (
    <>
      <path className={styles.dots} d={STARS} />
      <path className={styles.moon} d="M77 24.5A11 11 0 1 0 82 42 9 9 0 1 1 77 24.5Z" />
    </>
  );
}

export function WindowArt({ sky }: { sky: Sky }) {
  return (
    <>
      <path
        className={sky === 'day' ? styles.fillCandle : styles.fillNight}
        d="M6.2 96 5.8 47C6 22.5 27 4.3 50.2 4 73.2 4.4 93.6 22 94.2 47.2L93.8 96Z"
      />
      <Heavens sky={sky} />
      <path className={styles.fillDusk} d="M7 78C20 73.5 30 80 46 76.5S72 72 93 77.5L93 95.3H7Z" />
      <path d="M50 4.2V96M6 56.4C30 55.6 70 57.2 94 56.2" />
      <path d="M1.5 96.5H98.5V101.5H1.5Z" />
    </>
  );
}

/** The window at its drawn size, or at a given height with the same proportions. */
export function Window({ sky, className, height = 102 }: ArtProps & { sky: Sky; height?: number }) {
  return (
    <Art width={Math.round((100 * height) / 102)} height={height} box={[100, 102]} className={className}>
      <WindowArt sky={sky} />
    </Art>
  );
}
