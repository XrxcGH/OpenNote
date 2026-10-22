// checks-disable-file brand-consistency: the white of an exported picture, which must not follow the app theme
// Drawing and saving a figure (flag doc.figureExport): the SVG of a graph or diagram from the page, the captioned
// picture, and the PNG at the chosen DPI. The pure parts are in figure.ts.
import { t } from '../../strings/t';
import { captionedSvg, pngSize, svgSize, withDpi } from './figure';
import type { FigureOptions, FigureSource } from './figure';

/** The SVG of a graph or diagram block, or null when it draws nothing. */
export async function drawSource(source: FigureSource): Promise<string | null> {
  if (source.kind === 'graph') return (await import('../math')).exportGraph(source.source);
  const drawn = await (await import('../math')).drawDiagram(source.source);
  return drawn.ok ? drawn.svg : null;
}

/** The words the caption block uses, in the person's language. */
export const captionWords = (): Pick<FigureOptions, 'label' | 'sourceLabel'> => ({
  label: t('docStructure.figure.word'),
  sourceLabel: t('docStructure.figure.sourceWord'),
});

/** A figure's picture with its caption block, or null when the source draws nothing. */
export async function makeFigure(source: FigureSource, options: FigureOptions): Promise<string | null> {
  const svg = await drawSource(source);
  return svg === null ? null : captionedSvg(svg, { ...captionWords(), ...options });
}

/** Draws a captioned SVG on a canvas at the DPI and returns PNG bytes that carry the DPI. */
export async function toPngAt(svg: string, dpi: number): Promise<Uint8Array> {
  const size = svgSize(svg);
  const pixels = size && pngSize(size, dpi);
  if (!pixels) throw new Error('That picture is too large to draw.');
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The figure could not be drawn.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The figure could not be saved.');
  return withDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
}
