// The physics tools' Insert actions, on the page insert the other tools use: an answer line, an equation, a table,
// numbered steps, and the plot as a picture drawn in the theme's colors at the time of insert. The picture goes in
// as a PNG at twice its size, so exports and other apps show it as it looks here; SVG is the fallback.
import { insertIntoPage } from '../../ui/CalculatorTool';
import type { Palette } from '../kit/svg';
import type { KitInsert } from '../kit/types';

export const pageInsert: KitInsert = {
  answer: (text) => insertIntoPage({ text }),
  equation: (latex, display) => insertIntoPage({ math: { source: latex, display } }),
  table: (header, rows) => insertIntoPage({ table: { header, rows } }),
  steps: (lines) => insertIntoPage({ text: lines.map((line, i) => `${i + 1}. ${line}`).join('\n') }),
  picture: async (svg, alt) => {
    const png = await rasterize(svg);
    if (png) return insertIntoPage({ picture: { bytes: png, name: 'physics-figure.png', alt, mime: 'image/png' } });
    const bytes = new TextEncoder().encode(svg);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return insertIntoPage({ picture: { bytes: buffer, name: 'physics-figure.svg', alt, mime: 'image/svg+xml' } });
  },
};

/** The SVG drawn on a canvas at twice its size, as PNG bytes, or null when the browser cannot draw it. */
async function rasterize(svg: string, scale = 2): Promise<ArrayBuffer | null> {
  const width = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 520);
  const height = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 320);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
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

/** The theme's colors now, so a picture on the page keeps them when the window's theme changes. */
export function currentPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  // A font list holds double quotes, which would end the SVG's style attribute, so they become single quotes.
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim().replace(/"/g, "'") || fallback;
  return {
    ink: read('--color-text-primary', 'currentColor'),
    muted: read('--color-text-muted', 'currentColor'),
    grid: read('--color-border-subtle', 'currentColor'),
    accent: read('--color-accent-primary', 'currentColor'),
    second: read('--color-accent-clay', 'currentColor'),
    third: read('--color-accent-dusk', 'currentColor'),
    danger: read('--color-status-danger', 'currentColor'),
    font: read('--font-ui', 'inherit'),
    paper: read('--color-surface-page', 'Canvas'),
  };
}
