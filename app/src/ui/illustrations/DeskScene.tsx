// The desk by the window, 240 x 150, for the welcome step. It has the window with its sunset or its stars, a plant
// on the sill, a stack of books, an open notebook with the moss stroke, and a lit candle. It is built from the same
// parts as the smaller drawings, and it is the only place the whole desk appears.

import { Art } from './Art';
import type { ArtProps } from './Art';
import { BooksArt } from './Books';
import { CandleArt } from './Candle';
import { NotebookArt } from './Notebook';
import { PlantArt } from './Plant';
import { WindowArt } from './Window';
import type { Sky } from './Window';

export function DeskScene({ sky, className }: ArtProps & { sky: Sky }) {
  return (
    <Art width={240} height={150} className={className}>
      <g transform="translate(75 2) scale(0.9)">
        <WindowArt sky={sky} />
      </g>
      <g transform="translate(80 38) scale(0.8)">
        <PlantArt />
      </g>
      <path d="M10 128.4H230V135.4H10ZM22 136V148m196-12v12" />
      <g transform="translate(20 91)">
        <BooksArt />
      </g>
      <g transform="translate(98 99) scale(0.8)">
        <NotebookArt />
      </g>
      <g transform="translate(188 72.4)">
        <CandleArt />
      </g>
    </Art>
  );
}
