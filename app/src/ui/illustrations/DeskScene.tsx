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
import { WindowArt } from './Window';
import type { Sky } from './Window';

export function DeskScene({ sky, className }: ArtProps & { sky: Sky }) {
  return (
    <Art width={360} height={225} box={[240, 150]} className={className}>
      <path className={styles.fillPaper} d="M10 128.4H230V135.4H10ZM22 136V148m196-12v12" />
      <g transform="translate(75 2) scale(0.9)">
        <WindowArt sky={sky} />
      </g>
      <g transform="translate(76 38) scale(0.8)">
        <PlantArt />
      </g>
      <g transform="translate(20 90.3)">
        <BooksArt />
      </g>
      <g transform="translate(98 96.88) scale(0.8)">
        <NotebookArt />
      </g>
      <g transform="translate(176 72.4)">
        <CandleArt />
      </g>
      <g transform="translate(203 88.08) scale(0.72)">
        <CandleArt />
      </g>
    </Art>
  );
}
