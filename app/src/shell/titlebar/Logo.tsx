// The logo mark (BRAND.md section 8, brand/logo-mark.svg): a folded page with a moss-green ink stroke ending in a
// clay pen tip. It is drawn with color tokens, so it follows the theme and Windows contrast themes. The app name
// beside it names the app, so the mark is decorative.

import styles from './TitleBar.module.css';

export function Logo() {
  return (
    <svg className={styles.logo} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className={styles.logoPage} d="M16 6H40L54 20V52A6 6 0 0 1 48 58H16A6 6 0 0 1 10 52V12A6 6 0 0 1 16 6Z" />
      <path className={styles.logoFold} d="M40 6V16A4 4 0 0 0 44 20H54" />
      <path className={styles.logoInk} d="M18 44C21 33 28 29 31 36S39 47 45 35" />
      <circle className={styles.logoTip} cx="45" cy="35" r="3" />
    </svg>
  );
}
