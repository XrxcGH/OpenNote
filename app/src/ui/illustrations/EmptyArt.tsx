// The drawing above the sentence of an empty state: 110 px wide, about 50 px tall, and different for each place.
// "No notebooks yet" gets a bookshelf with a leaning book and a sprig. "No page open" gets an open notebook with a
// candle beside it. "Trash is empty" gets a candle beside a tidy stack of books. The sentence keeps the meaning,
// and the drawing is only company.

import { Art } from './Art';
import type { ArtProps } from './Art';
import { BooksArt } from './Books';
import { CandleArt } from './Candle';
import { NotebookArt } from './Notebook';
import styles from './illustrations.module.css';

export type EmptyKind = 'notebooks' | 'page' | 'trash';

const SHELF = 'M6 70.5C40 71.2 80 71.2 114 70.4';

function Shelf() {
  return (
    <>
      <path className={styles.fillDusk} d="M20 70.4 20.4 32.4C23 31.8 27 32 30 32.4L30.2 70.4Z" />
      <path className={styles.fillMoss} d="M31 70.4 31.2 41.4C33.6 41 37 41.2 39 41.4L39.2 70.4Z" />
      {/* The leaning book stands on its bottom-left corner, (48, 70.4), with its bottom-right corner lifted, and its
          left edge rests on the moss book's top-right corner, (39, 41.4): a 17.7 degree lean. The tests check that
          no part of it dips below the shelf or into the moss book. */}
      <path
        className={styles.fillNight}
        transform="rotate(-17.7 48 70.4)"
        d="M48 70.4 48.3 34.6C51.6 34.1 55 34.3 58 34.6L58 70.4Z"
      />
      <path className={styles.dusk} d="M22.6 40H27.6M22.6 44H27.6" />
      <path className={styles.moss} d="M90.2 56C90 50 90.8 44 90.2 35" />
      <path
        className={`${styles.fillMoss} ${styles.moss}`}
        d="M90.2 49C84.4 49.4 80.6 45.6 80 40.4 85.8 39.8 89.6 43.4 90.2 49Z"
      />
      <path
        className={`${styles.fillMoss} ${styles.moss}`}
        d="M90.2 43C96 43.4 99.8 39.6 100.4 34.4 94.6 33.8 90.8 37.4 90.2 43Z"
      />
      <path
        className={`${styles.fillMoss} ${styles.moss}`}
        d="M90.2 35.6C86.6 32.6 86.8 28.6 90.2 26 93.6 28.6 93.8 32.6 90.2 35.6Z"
      />
      <path className={styles.fillCandle} d="M82.4 56C87 55.4 93.4 55.4 98 56L96 70.4C92 70.9 88.4 70.9 84.4 70.4Z" />
    </>
  );
}

export function EmptyArt({ kind, className }: ArtProps & { kind: EmptyKind }) {
  // Each drawing is cropped to its content, so there is no empty paper above it, and its shelf starts where the
  // sentence below it starts.
  const shelf = kind === 'notebooks';
  return (
    <Art width={110} height={shelf ? 52 : 54} className={className}>
      <g transform={`translate(-5 ${shelf ? -22 : -20})`}>
        <path d={SHELF} />
        {shelf && <Shelf />}
        {kind === 'page' && (
          <g transform="translate(14 33.4)">
            <NotebookArt />
          </g>
        )}
        {kind === 'trash' && (
          <g transform="translate(14 32.8)">
            <BooksArt />
          </g>
        )}
        {!shelf && (
          <g transform="translate(86 25.8) scale(0.8)">
            <CandleArt />
          </g>
        )}
      </g>
    </Art>
  );
}
