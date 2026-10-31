// SVG text for the kits' plots and sketches: one element at a time, with every attribute and text escaped, and
// numbers rounded to hundredths of a pixel so the pictures stay small.

/** Text made safe for SVG content and attributes. */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A coordinate rounded to hundredths. */
export const px = (value: number): string => String(Math.round(value * 100) / 100);

export type Attrs = Readonly<Record<string, string | number | undefined>>;

/** One element. Numbers are rounded, undefined attributes are left out, and `text` is escaped. */
export function el(tag: string, attrs: Attrs, text?: string): string {
  const parts = Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}="${typeof value === 'number' ? px(value) : escapeXml(value)}"`);
  const open = `<${tag}${parts.length ? ` ${parts.join(' ')}` : ''}`;
  return text === undefined ? `${open}/>` : `${open}>${escapeXml(text)}</${tag}>`;
}

/** A standalone SVG document around `body`, with its title for readers. */
export function svgDocument(width: number, height: number, title: string, body: string): string {
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" ` +
    `height="${height}" font-family="system-ui, sans-serif" role="img">`;
  return `${head}${el('title', {}, title)}${body}</svg>`;
}
