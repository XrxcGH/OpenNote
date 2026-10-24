// The physics tools' Insert actions, on the page insert the other tools use: an answer line, an equation, a table,
// numbered steps, and the plot as an SVG picture drawn in the theme's colors at the time of insert.
import { insertIntoPage } from '../../ui/CalculatorTool';
import type { Palette } from '../kit/svg';
import type { KitInsert } from '../kit/types';

export const pageInsert: KitInsert = {
  answer: (text) => insertIntoPage({ text }),
  equation: (latex, display) => insertIntoPage({ math: { source: latex, display } }),
  table: (header, rows) => insertIntoPage({ table: { header, rows } }),
  steps: (lines) => insertIntoPage({ text: lines.map((line, i) => `${i + 1}. ${line}`).join('\n') }),
  picture: (svg, alt) => {
    const bytes = new TextEncoder().encode(svg);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return insertIntoPage({ picture: { bytes: buffer, name: 'physics-figure.svg', alt, mime: 'image/svg+xml' } });
  },
};

/** The theme's colors now, so a picture on the page keeps them when the window's theme changes. */
export function currentPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--color-text-primary', 'currentColor'),
    muted: read('--color-text-muted', 'currentColor'),
    grid: read('--color-border-subtle', 'currentColor'),
    accent: read('--color-accent-primary', 'currentColor'),
    second: read('--color-accent-clay', 'currentColor'),
    third: read('--color-accent-dusk', 'currentColor'),
    danger: read('--color-status-danger', 'currentColor'),
    font: read('--font-ui', 'inherit'),
  };
}
