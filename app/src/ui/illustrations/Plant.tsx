// A potted plant with a trailing vine, 56 x 66. Its leaves are moss and its pot is clay. The vine spills over the
// rim and trails along the surface to the left with three small leaves. It is drawn to be shown smaller, in the
// notebooks pane footer and on the window sill of the desk scene. No part of it hangs below the pot's base.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

/** The three small leaves on the trailing vine, as one path: each leaf is two curves from its stem to its tip. */
const TRAILING_LEAVES = [
  'M16.6 51.6Q14.9 47.6 11 49.5Q12.7 53.6 16.6 51.6Z',
  'M10.4 60.4Q14 58.2 11.4 55Q7.7 57.1 10.4 60.4Z',
  'M4.6 62.4Q5.8 58.5 1.7 58.3Q0.5 62.2 4.6 62.4Z',
].join('');

export function PlantArt() {
  return (
    <>
      <path className={styles.fillClay} d="M20 45H44L41.5 62.5C36 63.6 28 63.6 22.5 62.5Z" />
      <path d="M17.5 44.6C28 43.6 37 43.6 46.5 44.6" />
      <g className={styles.moss}>
        <path d="M32 44C31.4 34 32.4 23 32 12" />
        <path d="M21.5 46C15.5 49.5 18 55.6 12.4 59 9 61 6 62.4 2.6 62.6" />
        <g className={styles.fillMoss}>
          <path d="M32 35C24 35.6 19 30.6 18 23.4 26 22.6 31 27.6 32 35Z" />
          <path d="M32 25C40 25.6 45 20.6 46 13.4 38 12.6 33 17.6 32 25Z" />
          <path d="M32 12.6C28 8.6 28.6 3.6 32 1.4 35.4 3.6 36 8.6 32 12.6Z" />
          <path d={TRAILING_LEAVES} />
        </g>
      </g>
    </>
  );
}

/** The plant at the size of the notebooks pane footer. */
export function Plant({ className }: ArtProps) {
  return (
    <Art width={42} height={50} box={[56, 66]} className={className}>
      <PlantArt />
    </Art>
  );
}
