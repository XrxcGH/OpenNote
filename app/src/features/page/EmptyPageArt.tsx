// The empty page's illustration (BRAND.md section 8): a window at dusk with a crescent moon and stars, a candle
// and a potted plant on the sill, and a vine along the frame. Hand-drawn strokes in three token colors, with plenty
// of empty paper. It is decorative, so screen readers skip it; the text beside it says what to do.
import styles from './PageView.module.css';

export function EmptyPageArt() {
  return (
    <svg className={styles.art} viewBox="0 0 160 120" aria-hidden="true" focusable="false">
      <g className={styles.artFrame}>
        <path d="M42 102V46a38 38 0 0 1 76 0v56" />
        <path d="M80 9v93M42 64h76" />
        <path d="M30 102h100" />
      </g>
      <g className={styles.artSky}>
        <path d="M102 28a9 9 0 1 0 9 13 7 7 0 1 1-9-13z" />
        <path d="M58 30v6M55 33h6M66 48v4M64 50h4M95 54v3M93.5 55.5h3" />
      </g>
      <g className={styles.artCandle}>
        <path d="M52 102V86h9v16" />
        <path d="M56.5 81c-3-3.2-1.2-6.6 0-9 1.2 2.4 3 5.8 0 9z" />
      </g>
      <g className={styles.artPlant}>
        <path d="M98 102l2-11h14l2 11" />
        <path d="M107 91c0-6-1-11-6-15M107 91c1-7 3-11 8-13M107 91v-17" />
        <path d="M42 50c-7 6-9 14-6 22s-2 14-6 18" />
        <path d="M37 60c-4-1-6 1-7 4 3 1 6 0 7-4zM37 74c4 0 6 2 6 5-3 0-6-1-6-5zM32 86c-3-2-6-1-7 2 3 1 6 1 7-2z" />
      </g>
    </svg>
  );
}
