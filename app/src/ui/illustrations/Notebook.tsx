// An open notebook, 64 x 40, with warm paper pages in a moss cover that shows at the edges. On the right-hand page
// is the logo's ink: a moss stroke ending in a clay dot. Lying open, it rests on its spine, the lowest point of the
// cover, and its outer edges lift a little.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export function NotebookArt() {
  return (
    <>
      <path className={styles.fillMoss} d="M1.6 13V36.8C14 34 24 34.6 32 39.4 40 34.6 50 34 62.4 36.8V13Z" />
      <path className={styles.fillPaper} d="M3 9C14 6 24 7 32 12V37C24 32 14 31.4 3 34.4Z" />
      <path className={styles.fillPaper} d="M61 9C50 6 40 7 32 12V37C40 32 50 31.4 61 34.4Z" />
      <path d="M9 15.6C14 15 18.6 16 24 18.6M9 21.4C14 20.8 18.6 21.8 24 24.4M9 27.2C12 26.8 14 27.2 16 28" />
      <path className={styles.moss} d="M39.6 20.6C44 15.6 47 24.4 50.4 19.6S55 19 56 17.6" />
      <circle className={styles.dot} cx="57" cy="17" r="1.8" />
    </>
  );
}

export function Notebook({ className }: ArtProps) {
  return (
    <Art width={64} height={40} className={className}>
      <NotebookArt />
    </Art>
  );
}
