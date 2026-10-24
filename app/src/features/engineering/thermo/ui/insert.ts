// Putting a result on the open page: text at the caret, an equation, a table, or a plot as a picture. Each asks the
// page through the tools' insert event, like the calculator, and says whether a page took it.
import { INSERT_EVENT, type InsertDetail } from '../../../tools';

export function insertIntoPage(detail: Omit<InsertDetail, 'handled'>): boolean {
  const request: InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent<InsertDetail>(INSERT_EVENT, { detail: request }));
  return request.handled;
}

/** The plot's SVG drawn at twice its size as PNG bytes, or null when the browser cannot draw it. */
export async function svgToPng(svg: string, scale = 2): Promise<ArrayBuffer | null> {
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 480);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 300);
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
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
