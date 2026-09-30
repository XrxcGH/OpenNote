// Turns the sample document's blocks into DOM elements for the PDF export spike.
import type { Block } from './pdf-content';
import { PENS, arrow, ellipse, inkLayer, line, random, scribble, stroke, wave, type Sample } from './pdf-ink';

/** The raster image's size in pixels, and the CSS size it is shown at (1.5 image pixels per CSS pixel). */
export const IMAGE_PIXELS = { width: 360, height: 240 };
const IMAGE_CSS = { width: 240, height: 160 };

let imageUrl = '';

/** Returns a made-up micrograph as a PNG data URL. The canvas drawing happens only once. */
export function imageData(): string {
  if (imageUrl) return imageUrl;
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_PIXELS.width;
  canvas.height = IMAGE_PIXELS.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser has no 2D canvas.');
  const glow = context.createRadialGradient(180, 120, 20, 180, 120, 220);
  glow.addColorStop(0, '#F4EBD9');
  glow.addColorStop(1, '#C9B79A');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const rng = random(3);
  for (let i = 0; i < 26; i++) {
    const [x, y, r] = [rng() * 360, rng() * 240, 14 + rng() * 16];
    context.fillStyle = `rgba(${150 + rng() * 40}, ${120 + rng() * 30}, ${180 + rng() * 40}, 0.75)`;
    context.beginPath();
    context.ellipse(x, y, r, r * (0.7 + rng() * 0.3), rng() * Math.PI, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#5B3F7A';
    context.beginPath();
    context.arc(x + r * 0.2, y - r * 0.1, r * 0.3, 0, Math.PI * 2);
    context.fill();
  }
  imageUrl = canvas.toDataURL('image/png');
  return imageUrl;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Wraps the first occurrence of `phrase` in the paragraph's own text in a span that ink marks can find. */
function markPhrase(paragraph: HTMLElement, phrase: string | undefined, mark: string): void {
  if (!phrase) return;
  for (const text of [...paragraph.childNodes]) {
    const start = text instanceof Text ? text.data.indexOf(phrase) : -1;
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + phrase.length);
    const span = element('span', 'marked');
    span.dataset.ink = mark;
    range.surroundContents(span);
    return;
  }
}

function paragraph(block: Extract<Block, { kind: 'paragraph' }>): HTMLElement {
  const node = element('p', block.reading ? 'body reading' : 'body', block.text);
  markPhrase(node, block.highlight, 'highlight');
  markPhrase(node, block.circle, 'circle');
  if (block.mark) node.dataset.ink = block.mark;
  return node;
}

function table(block: Extract<Block, { kind: 'table' }>): HTMLElement {
  const node = element('table', 'grid');
  const head = node.createTHead().insertRow();
  for (const column of block.columns) head.append(element('th', '', column));
  const body = node.createTBody();
  for (const row of block.rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.append(element('td', '', cell));
  }
  return node;
}

function figure(caption: string, media: Element): HTMLElement {
  const node = element('figure', 'figure');
  node.append(media, element('figcaption', 'caption', caption));
  return node;
}

function image(caption: string): HTMLElement {
  const img = element('img', 'photo');
  img.src = imageData();
  img.width = IMAGE_CSS.width;
  img.height = IMAGE_CSS.height;
  img.alt = 'Rounded cells with dark nuclei on a tan background';
  return figure(caption, img);
}

/** A hand-drawn diagram: a membrane, proteins, ions, arrows, and handwritten labels. */
export function sketch(seed: number, width: number, height: number): SVGSVGElement {
  const svg = inkLayer('sketch', width, height);
  const rng = random(seed);
  const add = (samples: Sample[], color: string, size: number) => svg.append(stroke(samples, color, size));
  const top = height * 0.38;
  const bottom = height * 0.62;
  add(wave(16, top, width - 32, 5, 9), PENS.walnut, 3.2);
  add(wave(16, bottom, width - 32, 5, 9), PENS.walnut, 3.2);
  const proteins = Math.max(2, Math.round(width / 160));
  for (let i = 0; i < proteins; i++) {
    const cx = ((i + 0.5) * width) / proteins;
    add(ellipse(cx, height / 2, 26 + rng() * 10, (bottom - top) / 2 + 12, rng), PENS.indigo, 3);
    for (const [x0, y0, x1, y1] of [
      [cx - 34, top - 44, cx - 34, bottom + 30],
      [cx + 34, bottom + 44, cx + 34, top - 30],
    ]) {
      for (const part of arrow(x0, y0, x1, y1, rng)) add(part, i % 2 ? PENS.fern : PENS.brick, 2.6);
    }
    add(scribble(cx - 30, height - 18, 60, 16, rng), PENS.plum, 2.2);
  }
  for (let i = 0; i < 8; i++) {
    const [x, y] = [24 + rng() * (width - 48), 20 + rng() * (top - 50)];
    add(ellipse(x, y, 5, 5, rng), PENS.amber, 2.2);
  }
  add(line(16, height - 4, width * 0.4, height - 6, rng), PENS.walnut, 2);
  return svg;
}

function sketchFigure(block: Extract<Block, { kind: 'sketch' }>, width: number): HTMLElement {
  return figure(block.caption, sketch(block.seed, width, block.height));
}

/** Renders one block. `width` is the content width of the sheet it goes on, in CSS pixels. */
export function render(block: Block, width: number): HTMLElement {
  switch (block.kind) {
    case 'title': {
      const node = element('header', 'title-block');
      const title = element('h1', 'title', block.text);
      title.dataset.ink = 'underline';
      node.append(title, element('p', 'meta', block.meta));
      return node;
    }
    case 'heading': {
      const node = element('h2', 'heading', block.text);
      if (block.mark) node.dataset.ink = block.mark;
      return node;
    }
    case 'paragraph':
      return paragraph(block);
    case 'list': {
      const node = element('ul', 'list');
      for (const item of block.items) node.append(element('li', '', item));
      return node;
    }
    case 'table':
      return table(block);
    case 'image':
      return image(block.caption);
    case 'sketch':
      return sketchFigure(block, width);
    case 'code':
      return element('pre', 'code', block.lines.join('\n'));
    case 'group': {
      const node = element('div', 'keep-together');
      for (const child of block.blocks) node.append(render(child, width));
      return node;
    }
    case 'break':
      throw new Error('Page breaks are handled by the paginator, not rendered.');
  }
}
