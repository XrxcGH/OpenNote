// A potted plant with a trailing vine, 48 x 66: leaves in the moss tint, a dusk-tinted pot, and a vine that
// spills over the rim. It is small enough to sit in a corner, and it is drawn to be shown at about half size.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export function PlantArt() {
  return (
    <>
      <path className={styles.fillDusk} d="M12 45H36L33.5 62.5C28 63.6 20 63.6 14.5 62.5Z" />
      <path d="M9.5 44.6C20 43.6 29 43.6 38.5 44.6" />
      <g className={styles.moss}>
        <path d="M24 44C23.4 34 24.4 23 24 12" />
        <path d="M13.5 46C8 50 10.6 55.4 6.4 59.2 4.6 61.4 6.4 64 9.4 63.4" />
        <g className={styles.fillMoss}>
          <path d="M24 35C16 35.6 11 30.6 10 23.4 18 22.6 23 27.6 24 35Z" />
          <path d="M24 25C32 25.6 37 20.6 38 13.4 30 12.6 25 17.6 24 25Z" />
          <path d="M24 12.6C20 8.6 20.6 3.6 24 1.4 27.4 3.6 28 8.6 24 12.6Z" />
          <path d="M9 54.4C5.4 54.2 3.6 51 4.2 47.6 7.6 47.8 9.6 50.6 9 54.4Z" />
        </g>
      </g>
    </>
  );
}

export function Plant({ className }: ArtProps) {
  return (
    <Art width={28} height={38} box={[48, 66]} className={className}>
      <PlantArt />
    </Art>
  );
}
