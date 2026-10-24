// A potted plant with a trailing vine, 56 x 66. Its leaves are moss and its pot is clay. The vine spills over the
// rim and trails along the surface to the left with three small leaves. It is drawn to be shown smaller, in the
// notebooks pane footer and on the window sill of the desk scene. No part of it hangs below the pot's base.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';
import { PLANT } from './shapes';

/** The three small leaves on the trailing vine, as one path: each leaf is two curves from its stem to its tip. */
const TRAILING_LEAVES = PLANT.trailingLeaves.join('');

export function PlantArt() {
  return (
    <>
      <path className={styles.fillClay} d={PLANT.pot} />
      <path d={PLANT.rim} />
      <g className={styles.moss}>
        <path d={PLANT.stem} />
        <path d={PLANT.trailing} />
        <g className={styles.fillMoss}>
          {PLANT.leaves.map((d) => (
            <path key={d} d={d} />
          ))}
          <path d={TRAILING_LEAVES} />
        </g>
      </g>
    </>
  );
}

/** The plant at the size of the notebooks pane footer. */
export function Plant({ className }: ArtProps) {
  return (
    <Art width={42} height={50} box={PLANT.box} className={className}>
      <PlantArt />
    </Art>
  );
}
