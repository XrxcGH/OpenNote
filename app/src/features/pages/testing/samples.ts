// Sample pages for the tests and the benchmark of print and export. They are built from page.json data, so they go
// through the same reader as a real page. Text is plain English with a few accented and CJK words, so the text layer of
// a PDF can be compared with the text that went in.

import { deflateSync } from 'node:zlib';
import { readExportPage, type ExportPage, type ExportStroke } from '../export/source';
import type { JsonObject } from '../layout/json';

/** A solid-color PNG, as a data URI, of the given size in pixels. */
export function pngDataUri(width: number, height: number, rgb: readonly [number, number, number]): string {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc;
}

const SENTENCES = [
  'Light excites chlorophyll in the thylakoid membrane.',
  'Water is split, and oxygen is released as a by-product.',
  'The Calvin cycle fixes carbon dioxide into sugar.',
  'Énergie, café, naïve, and 光合成 all appear in this line.',
  'Plants make sugar from light, water, and air.',
];

/** A paragraph of `n` sentences, cycling through a fixed list so the text is the same every time. */
export function paragraph(n: number, seed = 0): string {
  return Array.from({ length: n }, (_, i) => SENTENCES[(i + seed) % SENTENCES.length]).join(' ');
}

interface Builder {
  readonly blocks: JsonObject[];
  readonly assets: Record<string, JsonObject>;
  readonly strokes: ExportStroke[];
}

let counter = 0;
const id = (prefix: string): string => `${prefix}${String((counter += 1)).padStart(4, '0')}`;

function add(b: Builder, type: string, data: JsonObject, frame?: JsonObject): string {
  const blockId = id('b');
  b.blocks.push({
    id: blockId,
    type,
    order: `a${String(b.blocks.length).padStart(5, '0')}`,
    data,
    ...(frame ? { frame } : {}),
  });
  return blockId;
}

/** A stroke that wanders along a wave, in page units. */
export function waveStroke(block: string, x0: number, y0: number, length: number, tool = 0): ExportStroke {
  const points = Math.max(2, Math.floor(length / 4));
  return {
    id: id('s'),
    block,
    start: counter,
    tool,
    color: tool === 2 ? [242, 207, 74, 102] : [47, 79, 154, 255],
    width: tool === 2 ? 14 : 2.5,
    x: Array.from({ length: points }, (_, i) => x0 + (i * length) / points),
    y: Array.from({ length: points }, (_, i) => y0 + Math.sin(i / 3) * 6),
    pressure: Array.from({ length: points }, (_, i) => 0.4 + 0.6 * Math.abs(Math.sin(i / 7))),
    transform: null,
  };
}

function table(b: Builder, rows: number, columns = 3): string {
  const cols = Array.from({ length: columns }, (_, c) => ({ id: `c${c}`, width: 600 / columns }));
  const data = Array.from({ length: rows }, (_, r) => ({
    id: `r${r}`,
    cells: Object.fromEntries(
      cols.map((c, ci) => [c.id, { markdown: r === 0 ? `Column ${ci + 1}` : `Row ${r} **cell ${ci + 1}**` }]),
    ),
  }));
  return add(b, 'table', { header: true, columns: cols, rows: data });
}

export interface SampleOptions {
  readonly paper?: { size: string; width: number; height: number };
  readonly orientation?: 'portrait' | 'landscape';
  readonly margins?: readonly number[];
  readonly pattern?: string;
}

function view(options: SampleOptions, layout: string): JsonObject {
  const paper = options.paper ?? { size: 'letter', width: 816, height: 1056 };
  const landscape = options.orientation === 'landscape';
  return {
    layout,
    mode: 'paginated',
    paper: {
      size: paper.size,
      orientation: landscape ? 'landscape' : 'portrait',
      width: landscape ? paper.height : paper.width,
      height: landscape ? paper.width : paper.height,
      margins: options.margins ?? [72, 72, 72, 72],
    },
    background: { pattern: options.pattern ?? 'plain' },
  };
}

function finish(b: Builder, title: string, json: JsonObject): ExportPage {
  return readExportPage(
    {
      id: 'sample',
      title,
      created: '2026-10-01T10:00:00.000Z',
      modified: '2026-10-01T10:00:00.000Z',
      tags: [],
      assets: b.assets,
      blocks: b.blocks,
      ...json,
    },
    b.strokes,
    'en',
  );
}

/** A lecture page: headings, paragraphs, lists, a callout, a quote, code, a table, an image, and a manual break. */
export function lecturePage(options: SampleOptions = {}, scale = 1): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  b.assets.img1 = { file: 'img1.png', mime: 'image/png', name: 'Leaf.png', width: 480, height: 320 };
  add(b, 'text', { markdown: `# Photosynthesis\n\n${paragraph(6)}` });
  for (let s = 0; s < Math.round(4 * scale); s += 1) {
    add(b, 'text', {
      markdown: [
        `## Section ${s + 1}: light reactions`,
        paragraph(9, s),
        `- First point about section ${s + 1}\n- Second point, with **bold** and *italic* text\n  - A nested point\n- Third point`,
        `> [!tip] Exam hint\n> Learn the Z-scheme diagram for section ${s + 1}.`,
        paragraph(7, s + 2),
      ].join('\n\n'),
    });
    if (s === 0) table(b, 22);
    if (s === 1) add(b, 'image', { asset: 'img1', alt: 'Cross-section of a leaf' });
    if (s === 2)
      add(b, 'text', { markdown: '```rust\nfn main() {\n    println!("light");\n}\n```\n\n> Life finds a way.' });
    if (s === 2) add(b, 'break', {});
  }
  add(b, 'embed', {}); // a type this version does not know shows a note
  add(b, 'text', { markdown: `## The end\n\n${paragraph(3)}` });
  return finish(b, 'Photosynthesis', { view: view(options, 'flow') });
}

/** A freeform page: text boxes and an image placed anywhere, and handwriting that crosses a sheet edge. */
export function freeformPage(options: SampleOptions = {}): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  b.assets.img1 = { file: 'img1.png', mime: 'image/png', name: 'Leaf.png', width: 480, height: 320 };
  const height = (options.paper?.height ?? 1056) * (options.orientation === 'landscape' ? 0.75 : 1);
  add(b, 'text', { markdown: `## Notes\n\n${paragraph(4)}` }, { x: 72, y: 80, w: 300 });
  add(b, 'text', { markdown: `## Ideas\n\n${paragraph(3, 1)}` }, { x: 420, y: 90, w: 280 });
  add(b, 'image', { asset: 'img1', alt: 'A leaf' }, { x: 90, y: height - 120, w: 240, h: 160 });
  add(b, 'text', { markdown: `${paragraph(2, 3)}` }, { x: 120, y: height + 80 });
  const layer = add(b, 'ink', { role: 'layer', strokeCount: 3 }, { x: 0, y: 0 });
  b.strokes.push(
    waveStroke(layer, 100, 400, 500),
    waveStroke(layer, 100, height - 2, 400),
    waveStroke(layer, 120, 430, 300, 2),
  );
  return finish(b, 'Sketches', { view: view(options, 'freeform') });
}

/** A long page of paragraphs, for the benchmark. About two sheets for each 12 blocks on Letter paper. */
export function longPage(blocks: number, options: SampleOptions = {}): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  for (let i = 0; i < blocks; i += 1) {
    add(b, 'text', { markdown: `## Heading ${i + 1}\n\n${paragraph(8, i)}\n\n- one\n- two` });
  }
  return finish(b, 'Long page', { view: view(options, 'flow') });
}

/** A page of equations: a display equation, inline math in a sentence, and a matrix. */
export function mathPage(options: SampleOptions = {}): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  add(b, 'text', {
    markdown: [
      '# Equations',
      'The roots of a quadratic come from one formula.',
      '$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$',
      'Euler tied five constants together: $e^{i\\pi} + 1 = 0$, and the sum $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$ follows.',
      '$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n\\begin{pmatrix} x \\\\ y \\end{pmatrix}\n$$',
      paragraph(2),
    ].join('\n\n'),
  });
  return finish(b, 'Equations', { view: view(options, 'flow') });
}

/** A page with a graph block: two functions and a view, as the grapher keeps them. */
export function graphPage(options: SampleOptions = {}): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  add(b, 'text', {
    markdown: [
      '# Waves',
      'Two curves on one plane.',
      '```graph\ny = sin(x)\ny = x^2 / 8 - 2\n@view -10 10 -4 4\n```',
      paragraph(2),
    ].join('\n\n'),
  });
  return finish(b, 'Waves', { view: view(options, 'flow') });
}

/** A page with a smart table that keeps a bar chart and a line chart of its numbers. */
export function chartPage(options: SampleOptions = {}): ExportPage {
  counter = 0;
  const b: Builder = { blocks: [], assets: {}, strokes: [] };
  add(b, 'text', { markdown: `# Sales\n\n${paragraph(2)}` });
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const sold = [12, 18, 9, 24, 30, 21];
  const cell = (markdown: string) => ({ markdown });
  add(b, 'table', {
    header: true,
    columns: [
      { id: 'c0', width: 200 },
      { id: 'c1', width: 200 },
    ],
    rows: [
      { id: 'r0', cells: { c0: cell('Month'), c1: cell('Sold') } },
      ...months.map((m, i) => ({ id: `r${i + 1}`, cells: { c0: cell(m), c1: cell(String(sold[i])) } })),
    ],
    smart: {
      charts: [
        { id: 'chart-bars', kind: 'bar', x: 'c0', series: ['c1'], title: 'Sold by month' },
        { id: 'chart-line', kind: 'line', x: 'c0', series: ['c1'], title: 'Trend of sales' },
      ],
    },
  });
  add(b, 'text', { markdown: `## After the charts\n\n${paragraph(2, 1)}` });
  return finish(b, 'Sales', { view: view(options, 'flow') });
}
