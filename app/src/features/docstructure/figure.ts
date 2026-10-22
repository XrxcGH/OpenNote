// checks-disable-file brand-consistency: colors written into an exported picture, which must not follow the app theme
// The citation-ready figure exporter (flag doc.figureExport): a graph or diagram as a numbered, captioned picture. The
// caption block sits under the picture ("Figure 3. ...", then an optional source line), so the file can go into a
// report as it is. SVG stays sharp at any size; PNG is drawn at the chosen DPI and carries that DPI in its header, so
// word processors place it at the right size. Pure text and bytes: drawing the PNG is in figureExport.ts.

export interface FigureOptions {
  /** The figure's number, as in "Figure 3". */
  readonly number: number;
  readonly caption: string;
  /** An optional line under the caption, such as "Data: lab 4". */
  readonly source?: string;
  /** The word before the number. Default "Figure". */
  readonly label?: string;
  /** The word before the source line. Default "Source". */
  readonly sourceLabel?: string;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const DPI_CHOICES: readonly number[] = [72, 150, 300, 600];
export const MAX_PIXELS = 100_000_000;

const FONT = 'system-ui, "Segoe UI", sans-serif';
const CAPTION_SIZE = 14;
const LINE = 20;
const PAD = 12;

export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** The size of an SVG picture in user units, from its width and height, else its viewBox. Null when it has neither. */
export function svgSize(svg: string): Size | null {
  const open = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!open) return null;
  const number = (name: string): number | null => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']([\\d.]+)(?:px)?["']`, 'i').exec(open)?.[1];
    return value === undefined ? null : Number(value);
  };
  const width = number('width');
  const height = number('height');
  if (width && height) return { width, height };
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*["']/i.exec(open);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null;
}

/** The text broken at spaces into lines of at most `limit` characters. A longer word has a line of its own. */
export function wrapCaption(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (line !== '' && line.length + 1 + word.length > limit) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** The caption block's lines: "Figure N. caption", wrapped, then the source line. */
export function captionLines(options: FigureOptions, width: number): string[] {
  const limit = Math.max(12, Math.floor((width - 2 * PAD) / (CAPTION_SIZE * 0.52)));
  const head = `${options.label ?? 'Figure'} ${options.number}.`;
  const lines = wrapCaption(`${head} ${options.caption}`.trim(), limit);
  const source = options.source?.trim();
  if (source) lines.push(...wrapCaption(`${options.sourceLabel ?? 'Source'}: ${source}`, limit));
  return lines;
}

/** One line of the caption block, set under a picture that is `top` units tall. The first line is bold. */
function captionLine(line: string, index: number, top: number): string {
  const y = top + PAD + (index + 1) * LINE - 6;
  const weight = index === 0 ? ' font-weight="600"' : '';
  const face = `font-family='${FONT}' font-size="${CAPTION_SIZE}" fill="#1c1b1a"${weight}`;
  return `<text x="${PAD}" y="${y}" ${face}>${escapeXml(line)}</text>`;
}

/** A picture with its caption block under it, as one SVG. Null when the picture has no readable size. */
export function captionedSvg(svg: string, options: FigureOptions): string | null {
  const size = svgSize(svg);
  const inner = /<svg\b[\s\S]*<\/svg>\s*$/i.exec(svg)?.[0];
  if (!size || !inner) return null;
  const lines = captionLines(options, size.width);
  const height = size.height + PAD + lines.length * LINE + PAD;
  const nested = inner.replace(/<svg\b/i, '<svg x="0" y="0"');
  const title = `${options.label ?? 'Figure'} ${options.number}`;
  const text = lines.map((line, i) => captionLine(line, i, size.height)).join('');
  const box = `width="${size.width}" height="${height}" viewBox="0 0 ${size.width} ${height}"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${box} role="img" aria-labelledby="figure-title figure-desc">`,
    `<title id="figure-title">${escapeXml(title)}</title>`,
    `<desc id="figure-desc">${escapeXml(options.caption)}</desc>`,
    `<rect width="${size.width}" height="${height}" fill="#ffffff"/>`,
    nested,
    `<g class="caption">${text}</g>`,
    '</svg>',
  ].join('');
}

/** The pixel size of a picture drawn at some DPI: its units are CSS pixels, 96 to the inch. */
export function pngSize(size: Size, dpi: number): Size | null {
  const scale = dpi / 96;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return width < 1 || height < 1 || width * height > MAX_PIXELS ? null : { width, height };
}

let table: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG bytes with a pHYs chunk that says the picture is `dpi` dots per inch. Other bytes come back as given. */
export function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || signature.some((b, i) => png[i] !== b)) return png;
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // meters
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  // IHDR is the first chunk: 8 signature bytes, then 4 length, 4 type, 13 data, 4 crc.
  const after = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, after));
  out.set(chunk, after);
  out.set(png.subarray(after), after + chunk.length);
  return out;
}

/** The DPI a PNG says it has, or null when it has no pHYs chunk in meters. */
export function readDpi(png: Uint8Array): number | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let at = 8; at + 12 <= png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'pHYs' && png[at + 16] === 1) return Math.round(view.getUint32(at + 8) * 0.0254);
    at += 12 + length;
  }
  return null;
}

/** A file name from the caption: letters and digits joined by hyphens, after "figure-N". */
export function figureFileName(options: FigureOptions, extension: 'svg' | 'png'): string {
  const stem = options.caption
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `figure-${options.number}${stem ? `-${stem}` : ''}.${extension}`;
}

export interface FigureSource {
  /** `graph` for a function graph block, `diagram` for a Mermaid diagram. */
  readonly kind: 'graph' | 'diagram';
  /** The text inside the fence. */
  readonly source: string;
  /** The first line, to tell figures apart in a list. */
  readonly preview: string;
}

/** The graphs and diagrams written as code blocks in some Markdown, in order. */
export function figureSources(markdown: string): FigureSource[] {
  const found: FigureSource[] = [];
  const pattern = /^```(graph|mermaid)[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm;
  for (const m of markdown.matchAll(pattern)) {
    const source = m[2];
    found.push({
      kind: m[1] === 'graph' ? 'graph' : 'diagram',
      source,
      preview: (source.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 60),
    });
  }
  return found;
}
