// The two small motifs in the desk gutter (docs/BRAND.md amendments A11 to A13): a vine that hangs from the top of
// the right gutter, and in the evening four stars that thin out down the left one. They sit behind the page, never
// animate, and show only while the gutter is 24 px or more (Workspace.module.css and illustrations.module.css).

import styles from './illustrations.module.css';
import { GUTTER_STARS, GUTTER_VINE } from './shapes';

export function DeskMotifs() {
  return (
    <>
      <svg
        className={styles.gutterVine}
        data-art="gutter-vine"
        viewBox={`0 0 ${GUTTER_VINE.box[0]} ${GUTTER_VINE.box[1]}`}
        width={GUTTER_VINE.box[0]}
        height={GUTTER_VINE.box[1]}
        aria-hidden="true"
        focusable="false"
      >
        <path d={GUTTER_VINE.stem} />
        <g className={styles.fillMoss}>
          {GUTTER_VINE.leaves.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <svg
        className={styles.gutterStars}
        data-art="gutter-stars"
        viewBox={`0 0 ${GUTTER_STARS.box[0]} ${GUTTER_STARS.box[1]}`}
        width={GUTTER_STARS.box[0]}
        height={GUTTER_STARS.box[1]}
        aria-hidden="true"
        focusable="false"
      >
        {GUTTER_STARS.stars.map(([cx, cy, r, opacity]) => (
          <circle key={cy} cx={cx} cy={cy} r={r} opacity={opacity} className={styles.spark} />
        ))}
      </svg>
    </>
  );
}
