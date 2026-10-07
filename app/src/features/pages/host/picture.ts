// Export as a picture: the selected blocks, or the whole page, as an SVG, or as a PNG drawn from that SVG. The page
// view supplies the box each block was laid out in. Text and tables travel inside the SVG as HTML, so the picture
// carries its own fonts and pictures as data URIs, because a picture drawn onto a canvas can't load files.
import { shownMounted } from '../../page';
import { dataUri, documentCss, lightTheme } from '../export';
import type { ExportAsset } from '../export';
import type { Rect } from '../pagination';
import { selectArea, selectLassoed, selectionSvg } from '../selection';
import type { Chosen, SelectMode, Selection } from '../selection';
import { inlineFontFaces } from './fonts';
import { exportLabels } from './exporter';
import type { PageSource } from './source';

export type PictureScope = 'selection' | 'page';

const MODE_KEY = 'opennote.pages.selectMode';

/**
 * Smart or exact, as the person chose it last in the picture dialog. It belongs to this device, in its browser
 * storage, so every read has a default and a write may fail.
 */
export function rememberedSelectMode(): SelectMode {
  try {
    return globalThis.localStorage?.getItem(MODE_KEY) === 'exact' ? 'exact' : 'smart';
  } catch {
    return 'smart';
  }
}

export function rememberSelectMode(mode: SelectMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode);
  } catch {
    // The choice is only lost for next time.
  }
}

/** The box of every block as the page view laid it out, in page units. */
export function blockBoxes(): Map<string, Rect> {
  const mounted = shownMounted.get();
  const boxes = new Map<string, Rect>();
  if (!mounted) return boxes;
  for (const block of mounted.layer.blocks()) {
    const element = mounted.layer.view(block.id)?.element;
    if (element)
      boxes.set(block.id, {
        x: element.offsetLeft,
        y: element.offsetTop,
        w: element.offsetWidth,
        h: element.offsetHeight,
      });
  }
  return boxes;
}

/**
 * The selection a scope stands for: exactly what the lasso picked (smart select, trimmed to those items), or
 * everything on the page.
 */
export function selectionFor(
  source: PageSource,
  scope: PictureScope,
  chosen: Chosen,
  mode: SelectMode = 'smart',
): Selection | null {
  const boxes = blockBoxes();
  if (scope === 'selection') return selectLassoed(source.page, chosen, mode, { boxes });
  const ids = [...boxes.keys()];
  let around: Rect | null = null;
  for (const id of ids) {
    const box = boxes.get(id);
    if (!box) continue;
    const x0 = Math.min(around?.x ?? box.x, box.x);
    const y0 = Math.min(around?.y ?? box.y, box.y);
    const x1 = Math.max(around ? around.x + around.w : 0, box.x + box.w);
    const y1 = Math.max(around ? around.y + around.h : 0, box.y + box.h);
    around = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Ink alone has no block box: with no boxes, the whole page's strokes decide the area.
  if (!around && scope === 'page') around = { x: 0, y: 0, w: 100_000, h: 100_000 };
  if (!around) return null;
  // The lasso sits just inside the box, so a block next to it that only shares an edge isn't taken.
  const g = 1;
  const lasso = [
    { x: around.x + g, y: around.y + g },
    { x: around.x + around.w - g, y: around.y + g },
    { x: around.x + around.w - g, y: around.y + around.h - g },
    { x: around.x + g, y: around.y + around.h - g },
  ];
  return selectArea(source.page, lasso, { boxes, mode: 'smart' });
}

async function assetDataUris(source: PageSource): Promise<Map<string, string>> {
  const uris = new Map<string, string>();
  await Promise.all(
    Object.values(source.page.assets).map(async (asset) => {
      const url = source.assetUrls[asset.id];
      if (!url) return;
      try {
        const response = await fetch(url);
        if (response.ok) uris.set(asset.id, dataUri(asset.mime, new Uint8Array(await response.arrayBuffer())));
      } catch {
        // The picture goes without an image it can't read.
      }
    }),
  );
  return uris;
}

export interface Picture {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly selection: Selection;
}

/** The picture of a selection, as SVG. */
export async function makePicture(source: PageSource, selection: Selection, label: string): Promise<Picture> {
  const [uris, fonts] = await Promise.all([assetDataUris(source), inlineFontFaces().catch(() => '')]);
  const svg = selectionSvg(source.page, selection, {
    boxes: blockBoxes(),
    assetUrl: (asset: ExportAsset) => uris.get(asset.id) ?? null,
    background: lightTheme().colors.page,
    css: documentCss(lightTheme(fonts)) + '\n.selection-text{font-family:var(--font-reading,serif)}',
    labels: exportLabels(),
    label,
  });
  return { svg, width: selection.crop.w, height: selection.crop.h, selection };
}

/** The largest side of a canvas, in pixels, that the browser draws reliably. */
export const MAX_PIXELS = 16_384;

/** Draws an SVG picture onto a canvas at `scale` times its size and encodes it as a PNG. */
export async function svgToPng(picture: Picture, scale: number): Promise<Blob> {
  const width = Math.round(picture.width * scale);
  const height = Math.round(picture.height * scale);
  if (width > MAX_PIXELS || height > MAX_PIXELS) throw new RangeError('The picture is too large at this resolution.');
  // A data URL, not a blob URL. Chromium marks a canvas as tainted after it draws an SVG with embedded HTML from a
  // blob, and the picture can't be read back. The same SVG from a data URL is drawn clean.
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser has no canvas.');
  context.drawImage(image, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be encoded.'))),
      'image/png',
    ),
  );
}
