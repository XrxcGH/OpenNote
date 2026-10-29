// A graph as a picture: the export SVG (exportRenderers.ts) drawn onto a canvas at twice its size and saved as PNG,
// so it can go on the page as an image, where it no longer changes with its text. Browser only.
import { t } from '../../../strings/t';
import { exportGraph } from '../exportRenderers';
import { readGraph } from './source';

export interface GraphPicture {
  bytes: ArrayBuffer;
  name: string;
  alt: string;
  mime: 'image/png';
}

/** The PNG of the graph a block's text describes, or null when it plots nothing or the browser cannot draw it. */
export async function graphPicture(source: string, scale = 2): Promise<GraphPicture | null> {
  const svg = exportGraph(source);
  if (svg === null) return null;
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 640);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 360);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const functions = readGraph(source).functions.join('; ');
    return {
      bytes: await blob.arrayBuffer(),
      name: 'Graph.png',
      alt: t('mathTools.graph3d.pictureAlt', { functions }),
      mime: 'image/png',
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
