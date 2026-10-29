// A stack of four books, 64 x 40, each spine its own tint, with a clay bookmark ribbon. They lie flat, spines
// alternating, each a little shorter than the one below, like a tidy pile.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';
import { BOOKS } from './shapes';

export function BooksArt() {
  return (
    <>
      <path className={styles.fillDusk} d={BOOKS.books[0]} />
      <path className={styles.fillMoss} d={BOOKS.books[1]} />
      <path className={styles.fillNight} d={BOOKS.books[2]} />
      <path className={styles.fillCandle} d={BOOKS.books[3]} />
      <path d={BOOKS.spines} />
      <path className={styles.clay} d={BOOKS.bookmark} />
    </>
  );
}

export function Books({ className }: ArtProps) {
  return (
    <Art width={BOOKS.box[0]} height={BOOKS.box[1]} className={className}>
      <BooksArt />
    </Art>
  );
}
