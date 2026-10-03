// The signature stroke, 56 x 8: moss ink ending in a clay dot, like the logo's pen. It goes under the setup
// headings and the About heading, and it is always paired with text.

import styles from './illustrations.module.css';
import type { ArtProps } from './Art';

export function InkStroke({ className }: ArtProps) {
  return (
    <svg
      className={className ? `${styles.stroke} ${className}` : styles.stroke}
      viewBox="0 0 56 8"
      width={56}
      height={8}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 5.4C11 1.6 17 7.6 26 4.6S41 2 49 4.2" />
      <circle className={styles.dot} cx="52" cy="4" r="1.75" />
    </svg>
  );
}
