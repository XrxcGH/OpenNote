// checks-disable-file brand-consistency: colors written into an exported picture, which must not follow the app theme

// A mind map as a picture, for export as SVG, PNG, or PDF. The main idea is on the left and each level is a column to
// its right, as on the page. The picture always uses the light paper colors, so it prints and shares well. It carries a
// title and a description made of the outline, so a screen reader can read it too. Pure: no DOM until `toPng`.
import type { MapNode } from './tree';
import { toOutline } from './tree';

const ROW = 44;
const CHIP_HEIGHT = 32;
const GAP = 56;
const MARGIN = 24;
const CHAR = 8.2;
const MIN_WIDTH = 72;
const MAX_WIDTH = 260;

const COLORS = {
  text: '#1f2a37',
  chip: '#f6f1e8',
  chipStroke: '#b9ab9b',
  root: '#2f4f4f',
  rootText: '#ffffff',
  link: '#8c7f70',
};

interface Placed {
  node: MapNode;
  x: number;
  y: number;
  w: number;
  lines: string[];
  parent: Placed | null;
}

export interface MapPicture {
  svg: string;
  width: number;
  height: number;
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** The text broken into lines of at most `limit` characters, on spaces where it can. */
export function wrapLines(text: string, limit = 28): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= limit) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length > 0 ? lines : [''];
}

const widthOf = (lines: readonly string[]) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.max(...lines.map((line) => [...line].length)) * CHAR + 28));

/** Lays the map out: every node, with the whole tree (folded branches too) so nothing is lost from the picture. */
function layout(root: MapNode): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  const columns: number[] = [];
  const measure = (node: MapNode, depth: number) => {
    const lines = wrapLines(node.text);
    columns[depth] = Math.max(columns[depth] ?? 0, widthOf(lines));
    node.children.forEach((child) => measure(child, depth + 1));
  };
  measure(root, 0);
  const starts = columns.map((_, depth) => MARGIN + columns.slice(0, depth).reduce((sum, w) => sum + w + GAP, 0));
  let nextRow = 0;
  const place = (node: MapNode, depth: number, parent: Placed | null): Placed => {
    const lines = wrapLines(node.text);
    const me: Placed = { node, x: starts[depth], y: 0, w: columns[depth], lines, parent };
    const kids = node.children.map((child) => place(child, depth + 1, me));
    const rows = Math.max(1, Math.ceil((lines.length * 18 + 14) / ROW));
    if (kids.length === 0) {
      me.y = nextRow * ROW + (rows * ROW) / 2;
      nextRow += rows;
    } else {
      me.y = (kids[0].y + kids[kids.length - 1].y) / 2;
    }
    placed.push(me);
    return me;
  };
  place(root, 0, null);
  const width = MARGIN * 2 + columns.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, columns.length - 1);
  return { placed, width, height: Math.max(nextRow, 1) * ROW + MARGIN * 2 };
}

/** The map as an SVG picture with its description. `title` names it for assistive technology. */
export function mapSvg(root: MapNode, title: string): MapPicture {
  const { placed, width, height } = layout(root);
  const top = MARGIN;
  const links = placed
    .filter((one) => one.parent)
    .map((one) => {
      const from = one.parent as Placed;
      const x1 = from.x + from.w;
      const y1 = from.y + top;
      const x2 = one.x;
      const y2 = one.y + top;
      const mid = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}" fill="none" stroke="${COLORS.link}" stroke-width="2"/>`;
    });
  const chips = placed.map((one) => {
    const isRoot = one.parent === null;
    const high = Math.max(CHIP_HEIGHT, one.lines.length * 18 + 14);
    const y = one.y + top - high / 2;
    const text = one.lines
      .map((line, index) => `<tspan x="${one.x + one.w / 2}" dy="${index === 0 ? 0 : 18}">${escapeXml(line)}</tspan>`)
      .join('');
    const first = one.y + top - ((one.lines.length - 1) * 18) / 2 + 5;
    return (
      // checks-disable-next-line length: one SVG element written as one string
      `<rect x="${one.x}" y="${y}" width="${one.w}" height="${high}" rx="16" fill="${isRoot ? COLORS.root : COLORS.chip}" stroke="${isRoot ? COLORS.root : COLORS.chipStroke}"/>` +
      // checks-disable-next-line length: one SVG element written as one string
      `<text x="${one.x + one.w / 2}" y="${first}" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="15"${isRoot ? ' font-weight="600"' : ''} fill="${isRoot ? COLORS.rootText : COLORS.text}">${text}</text>`
    );
  });
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`,
    `<title>${escapeXml(title)}</title>`,
    `<desc>${escapeXml(toOutline(root))}</desc>`,
    `<rect width="${w}" height="${h}" fill="#ffffff"/>`,
    ...links,
    ...chips,
    '</svg>',
  ].join('');
  return { svg, width: w, height: h };
}

/** Draws the picture on a canvas and returns the PNG bytes. `scale` is how many pixels for each picture unit. */
export async function toPng(picture: MapPicture, scale = 2): Promise<Uint8Array> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The map picture could not be drawn.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(picture.width * scale);
  canvas.height = Math.round(picture.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The map picture could not be saved.');
  return new Uint8Array(await blob.arrayBuffer());
}
