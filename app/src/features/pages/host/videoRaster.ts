// The shown page as pixels for a narrated video: the page without its ink (the replay draws the ink again, stroke by
// stroke), and the look of each stroke, so the replay draws it the way the page does. Nothing is saved or shown.
import type { CommandContext } from '../../../commands/types';
import { pageSelection } from '../../page';
import { makePicture, selectionFor } from './picture';
import { collectSource } from './source';

export interface RasterStroke {
  id: string;
  /** Red, green, blue, and alpha bytes. */
  color: readonly [number, number, number, number];
  /** The nominal width in page units. */
  width: number;
}

export interface PageRaster {
  width: number;
  height: number;
  /** RGBA rows from the top. */
  rgba: Uint8ClampedArray;
  /** Pixels for a page unit. */
  scale: number;
  /** Where the picture sits on the page, in page units. */
  origin: { x: number; y: number };
  strokes: RasterStroke[];
}

/** The widest picture, in pixels. The video is no wider. */
const MAX_WIDTH = 1280;

export async function rasterShownPage(ctx: Pick<CommandContext, 'notes'>): Promise<PageRaster | null> {
  const source = await collectSource(ctx.notes);
  if (!source) return null;
  const area = selectionFor(source, 'page', pageSelection.get());
  if (!area) return null;
  const inked = source.page.strokes.filter((stroke) => area.strokes.includes(stroke.id));
  const picture = await makePicture(source, { ...area, strokes: [] }, source.title);
  const scale = Math.min(2, MAX_WIDTH / picture.width);
  const width = Math.max(2, Math.round(picture.width * scale));
  const height = Math.max(2, Math.round(picture.height * scale));
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser has no canvas.');
  context.drawImage(image, 0, 0, width, height);
  return {
    width,
    height,
    rgba: context.getImageData(0, 0, width, height).data,
    scale,
    origin: { x: area.crop.x, y: area.crop.y },
    strokes: inked.map((stroke) => ({ id: stroke.id, color: stroke.color, width: stroke.width })),
  };
}
