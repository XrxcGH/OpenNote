// An open notebook, 64 x 40, with warm paper pages in a moss cover that shows at the edges. On the right-hand page
// is the logo's ink: a moss stroke ending in a clay dot. Lying open, it rests on its spine, the lowest point of the
// cover, and its outer edges lift a little.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';
import { NOTEBOOK } from './shapes';

export function NotebookArt() {
  return (
    <>
      <path className={styles.fillMoss} d={NOTEBOOK.cover} />
      <path className={styles.fillPaper} d={NOTEBOOK.left} />
      <path className={styles.fillPaper} d={NOTEBOOK.right} />
      <path d={NOTEBOOK.lines} />
      <path className={styles.moss} d={NOTEBOOK.stroke} />
      <circle className={styles.dot} {...NOTEBOOK.dot} />
    </>
  );
}

export function Notebook({ className }: ArtProps) {
  return (
    <Art width={NOTEBOOK.box[0]} height={NOTEBOOK.box[1]} className={className}>
      <NotebookArt />
    </Art>
  );
}
