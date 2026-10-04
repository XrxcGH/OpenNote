// The desk by the window, drawn at 240 x 150 and shown at 360 x 225, for the welcome step. The window shows its
// sunset or its stars, with a vine along its frame and a plant on the sill. On the warm desk below are a stack of
// four books, an open notebook with the moss stroke, and two lit candles of different heights. It is built from the
// same parts as the smaller drawings, and it is the only place the whole desk appears.

import { Art } from './Art';
import type { ArtProps } from './Art';
import { BooksArt } from './Books';
import { CandleArt } from './Candle';
import styles from './illustrations.module.css';
import { NotebookArt } from './Notebook';
import { PlantArt } from './Plant';
import { DESK } from './shapes';
import { WindowArt } from './Window';
import type { Sky } from './Window';

/** The transform that puts a part at its place on the desk. */
const place = ({ at, scale }: { at: readonly [number, number]; scale: number }) =>
  `translate(${at[0]} ${at[1]}) scale(${scale})`;

export function DeskScene({ sky, className }: ArtProps & { sky: Sky }) {
  return (
    <Art width={360} height={225} box={DESK.box} className={className}>
      <path className={styles.fillPaper} d={DESK.slab} />
      <g transform={place(DESK.window)}>
        <WindowArt sky={sky} />
      </g>
      <g transform={place(DESK.plant)}>
        <PlantArt />
      </g>
      <g transform={place(DESK.books)}>
        <BooksArt />
      </g>
      <g transform={place(DESK.notebook)}>
        <NotebookArt />
      </g>
      <g transform={place(DESK.candle)}>
        <CandleArt />
      </g>
      <g transform={place(DESK.shortCandle)}>
        <CandleArt />
      </g>
    </Art>
  );
}
