// A stack of three books, 64 x 40, each tinted differently, with a clay bookmark ribbon. They lie flat, spines
// alternating, like a tidy pile.

import { Art } from './Art';
import type { ArtProps } from './Art';
import styles from './illustrations.module.css';

export function BooksArt() {
  return (
    <>
      <path className={styles.fillDusk} d="M2.5 37.6C20 38.3 44 38.2 61.5 37.5L62 29.8C44 29.2 20 29.3 2 30Z" />
      <path className={styles.fillMoss} d="M9 29.6C24 29.9 42 29.8 58 29.4L57.6 22C42 22.4 24 22.3 8.6 22Z" />
      <path className={styles.fillNight} d="M5.5 21.8C20 22.2 36 22.1 49.6 21.7L49.2 15C36 15.4 20 15.3 5.2 15Z" />
      <path d="M7 30.2v7.4m3.4-7.5v7.6m43.2-15.5v7.3m-3.2-7.2v7.2M10 15.2v6.6m3.4-6.6v6.7" />
      <path className={styles.clay} d="M44 29.8V35.6L45.8 34.4 47.6 35.6V29.8" />
    </>
  );
}

export function Books({ className }: ArtProps) {
  return (
    <Art width={64} height={40} className={className}>
      <BooksArt />
    </Art>
  );
}
