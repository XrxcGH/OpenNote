// checks-disable-file length: SVG attribute strings are written as one line each

// Draws one snapshot of the memory tracer as SVG. The stack and globals are on the left and the heap on the right.
// Each variable or heap block is a row of boxes with its value. Every pointer has an arrow to the box it points at.
// A reference is a small box with a dashed arrow, and freed blocks are dashed. It is built from numbers and text only.
import { escapeXml } from './kit/format';
import { svgWrap, type Palette } from './kit/plot';
import type { BlockView, Snapshot } from './memRun';

const CELL_W = 74;
const CELL_H = 30;
const BLOCK_H = 66;
const GAP = 12;
const HEAD = 20;
const MARGIN = 12;
const MID = 120;

export interface MemLabels {
  stack: string;
  heap: string;
  globals: string;
  freed: string;
  nullPointer: string;
}

interface Box {
  block: BlockView;
  x: number;
  y: number;
  /** True for a block in the heap column. */
  heap: boolean;
}

export type Side = 'right' | 'left' | 'up' | 'down';

export interface Arrow {
  from: [number, number];
  to: [number, number];
  /** The side each end leaves or enters by, so the curve bends the right way. */
  fromSide: Side;
  toSide: Side;
  /** A reference rather than a pointer. */
  dashed: boolean;
}

export interface MemLayout {
  boxes: Box[];
  headings: { text: 'stack' | 'heap' | 'globals' | 'frame'; name?: string; x: number; y: number }[];
  arrows: Arrow[];
  width: number;
  height: number;
}

const widthOf = (b: BlockView): number => Math.max(1, b.cells.length) * CELL_W;

/** Where everything in a snapshot goes. */
export function layoutMemory(snap: Snapshot): MemLayout {
  const left: BlockView[] = [];
  const headings: MemLayout['headings'] = [];
  const boxes: Box[] = [];
  let y = MARGIN;
  const place = (list: BlockView[], heap: boolean, x: number) => {
    for (const block of list) {
      boxes.push({ block, x, y, heap });
      y += BLOCK_H + GAP;
    }
  };
  const leftWidth = Math.max(
    CELL_W * 1.5,
    ...[...snap.globals, ...snap.frames.flatMap((f) => f.vars)].map((b) => widthOf(b)),
  );
  const heapX = MARGIN + leftWidth + MID;
  if (snap.globals.length > 0) {
    headings.push({ text: 'globals', x: MARGIN, y });
    y += HEAD;
    place(snap.globals, false, MARGIN);
    left.push(...snap.globals);
  }
  for (const frame of snap.frames) {
    headings.push({ text: 'frame', name: frame.fn, x: MARGIN, y });
    y += HEAD;
    place(frame.vars, false, MARGIN);
    left.push(...frame.vars);
  }
  const leftEnd = y;
  y = MARGIN;
  if (snap.heap.length > 0) {
    headings.push({ text: 'heap', x: heapX, y });
    y += HEAD;
    place(snap.heap, true, heapX);
  }
  const byId = new Map(boxes.filter((b) => b.block.id >= 0).map((b) => [b.block.id, b]));
  const arrows: Arrow[] = [];
  const top = (box: Box) => box.y + HEAD - 4;
  // Where an arrow leaves a pointer: out of the right of a lone box, or under the cell of a row of them.
  const leave = (box: Box, i: number): { p: [number, number]; side: Side } =>
    box.block.cells.length > 1
      ? { p: [box.x + i * CELL_W + CELL_W / 2, top(box) + CELL_H], side: 'down' }
      : { p: [box.x + (box.block.cells.length === 0 ? CELL_W * 1.5 : CELL_W), top(box) + CELL_H / 2], side: 'right' };
  // Where it arrives: the near side of a lone box, or the top of the chosen cell in a row.
  const arrive = (box: Box, index: number): { p: [number, number]; side: Side } =>
    box.block.cells.length > 1
      ? { p: [box.x + index * CELL_W + CELL_W / 2, top(box)], side: 'up' }
      : box.heap
        ? { p: [box.x, top(box) + CELL_H / 2], side: 'left' }
        : { p: [box.x + CELL_W, top(box) + CELL_H / 2], side: 'right' };
  const connect = (from: Box, i: number, to: Box, index: number, dashed: boolean) => {
    const a = leave(from, i);
    const b = arrive(to, index);
    arrows.push({ from: a.p, to: b.p, fromSide: a.side, toSide: b.side, dashed });
  };
  for (const box of boxes) {
    box.block.cells.forEach((cell, i) => {
      if (typeof cell.points !== 'object') return;
      const target = byId.get(cell.points.block);
      if (target) connect(box, i, target, cell.points.index, false);
    });
    if (box.block.refTo) {
      const target = byId.get(box.block.refTo.block);
      if (target) connect(box, 0, target, box.block.refTo.index, true);
    }
  }
  const right = snap.heap.length > 0 ? heapX + Math.max(...snap.heap.map(widthOf)) : MARGIN + leftWidth + 50;
  return { boxes, headings, arrows, width: right + MARGIN, height: Math.max(leftEnd, y, 60) + MARGIN };
}

const PUSH: Record<Side, [number, number]> = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

function arrowPath(a: Arrow): string {
  const [x1, y1] = a.from;
  const [x2, y2] = a.to;
  const d = Math.max(36, Math.min(90, Math.hypot(x2 - x1, y2 - y1) / 2));
  const p = (n: number) => n.toFixed(1);
  const c1: [number, number] = [x1 + PUSH[a.fromSide][0] * d, y1 + PUSH[a.fromSide][1] * d];
  const c2: [number, number] = [x2 + PUSH[a.toSide][0] * d, y2 + PUSH[a.toSide][1] * d];
  return `M${p(x1)},${p(y1)} C${p(c1[0])},${p(c1[1])} ${p(c2[0])},${p(c2[1])} ${p(x2)},${p(y2)}`;
}

const text = (
  x: number,
  y: number,
  size: number,
  fill: string,
  body: string,
  anchor = 'middle',
  weight = 400,
): string =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" ` +
  `font-weight="${weight}">${escapeXml(body)}</text>`;

/** The snapshot as an SVG picture. `alt` is the description a screen reader gets. */
export function memorySvg(snap: Snapshot, palette: Palette, labels: MemLabels, alt: string): string {
  const lay = layoutMemory(snap);
  const parts: string[] = [
    `<defs><marker id="mem-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${palette.accent}"/></marker></defs>`,
  ];
  for (const h of lay.headings) {
    const name = h.text === 'frame' ? `${h.name ?? ''}()` : labels[h.text];
    parts.push(text(h.x, h.y + 13, 12, palette.muted, name, 'start', 600));
  }
  for (const { block, x, y } of lay.boxes) {
    const top = y + HEAD - 4;
    const dash = block.freed ? ' stroke-dasharray="4 3"' : '';
    const title = `${block.name ? `${block.name}: ` : ''}${block.type}${block.freed ? ` (${labels.freed})` : ''}`;
    parts.push(text(x, top - 4, 11, palette.text, title, 'start', 600));
    if (block.refTo && block.cells.length === 0) {
      parts.push(
        `<rect x="${x}" y="${top}" width="${CELL_W * 1.5}" height="${CELL_H}" rx="3" fill="none" stroke="${palette.muted}" stroke-dasharray="4 3"/>`,
        text(x + CELL_W * 0.75, top + 19, 11, palette.muted, block.addr),
      );
      continue;
    }
    block.cells.forEach((cell, i) => {
      const cx = x + i * CELL_W;
      const fill = cell.changed ? palette.accent : 'none';
      parts.push(
        `<rect x="${cx}" y="${top}" width="${CELL_W}" height="${CELL_H}" fill="${fill}" fill-opacity="0.16" ` +
          `stroke="${palette.text}" stroke-width="1.4"${dash}/>`,
      );
      const value = cell.points === 'null' ? labels.nullPointer : cell.text;
      parts.push(text(cx + CELL_W / 2, top + 19, 11, cell.uninit ? palette.muted : palette.text, value));
      if (block.isArray || block.cells.length > 1) {
        parts.push(text(cx + CELL_W / 2, top + CELL_H + 11, 9, palette.muted, cell.label));
      } else {
        parts.push(text(cx + CELL_W / 2, top + CELL_H + 11, 9, palette.muted, cell.addr));
      }
    });
  }
  for (const a of lay.arrows) {
    parts.push(
      `<path d="${arrowPath(a)}" fill="none" stroke="${palette.accent}" stroke-width="1.6"` +
        `${a.dashed ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#mem-arrow)"/>`,
    );
  }
  return svgWrap(parts, palette, Math.ceil(lay.width), Math.ceil(lay.height), alt);
}
