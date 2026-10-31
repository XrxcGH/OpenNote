// Pictures for alignment: the dynamic-programming matrix with its arrows and the traceback path, for short
// sequences, and a dot plot. The path is marked by an outline and a fill, and arrows are drawn as glyphs.
import type { Figure, Shape } from '../figure';
import { fmt } from '../shared';
import { DIAG, LEFT, UP } from './engine';
import type { Alignment } from './engine';

const CELL = 30;

function headers(a: string, b: string, at: (i: number, j: number) => { x: number; y: number }): Shape[] {
  const shapes: Shape[] = [];
  [...b].forEach((ch, j) => {
    const p = at(0, j + 1);
    shapes.push({
      kind: 'text',
      x: p.x + CELL / 2,
      y: p.y - 8,
      label: ch,
      size: 13,
      anchor: 'middle',
      bold: true,
      mono: true,
    });
  });
  [...a].forEach((ch, i) => {
    const p = at(i + 1, 0);
    shapes.push({
      kind: 'text',
      x: p.x - 10,
      y: p.y + CELL / 2 + 5,
      label: ch,
      size: 13,
      anchor: 'middle',
      bold: true,
      mono: true,
    });
  });
  return shapes;
}

function arrowGlyphs(bits: number, x: number, y: number): Shape[] {
  const glyphs: Shape[] = [];
  if (bits & DIAG) glyphs.push({ kind: 'text', x: x + 2, y: y + 9, label: '↖', size: 8, tone: 'muted' });
  if (bits & UP)
    glyphs.push({ kind: 'text', x: x + CELL / 2, y: y + 9, label: '↑', size: 8, anchor: 'middle', tone: 'muted' });
  if (bits & LEFT) glyphs.push({ kind: 'text', x: x + 2, y: y + CELL / 2 + 3, label: '←', size: 8, tone: 'muted' });
  return glyphs;
}

/** The score matrix with sequence a down the side and b across the top. */
export function matrixFigure(a: string, b: string, result: Alignment): Figure {
  const left = 30;
  const top = 26;
  const at = (i: number, j: number) => ({ x: left + j * CELL, y: top + i * CELL });
  const onPath = new Set(result.path.map(([i, j]) => `${i},${j}`));
  const shapes: Shape[] = headers(a, b, at);
  result.matrix.forEach((row, i) =>
    row.forEach((value, j) => {
      const p = at(i, j);
      const path = onPath.has(`${i},${j}`);
      shapes.push({
        kind: 'rect',
        x: p.x,
        y: p.y,
        w: CELL,
        h: CELL,
        fill: path ? 'faint' : 'none',
        stroke: path ? 'accent' : 'faint',
        width: path ? 2 : 1,
      });
      const text = Number.isFinite(value) ? fmt(value, 4) : '−∞';
      shapes.push({
        kind: 'text',
        x: p.x + CELL - 3,
        y: p.y + CELL - 6,
        label: text,
        size: 10,
        anchor: 'end',
        bold: path,
      });
      if (result.arrows) shapes.push(...arrowGlyphs(result.arrows[i]![j]!, p.x, p.y));
    }),
  );
  return { width: left + (b.length + 1) * CELL + 6, height: top + (a.length + 1) * CELL + 6, shapes };
}

/** Dots where windows of the two sequences agree; a down the side, b across the top. */
export function dotFigure(a: string, b: string, dots: [number, number][]): Figure {
  const size = 320;
  const pad = 30;
  const sx = size / Math.max(1, b.length);
  const sy = size / Math.max(1, a.length);
  const shapes: Shape[] = [
    { kind: 'rect', x: pad, y: pad, w: size, h: size, stroke: 'muted', width: 1 },
    { kind: 'text', x: pad + size / 2, y: pad - 10, label: { word: 'align.h.seqB' }, size: 11, anchor: 'middle' },
    {
      kind: 'text',
      x: pad - 12,
      y: pad + size / 2,
      label: { word: 'align.h.seqA' },
      size: 11,
      anchor: 'middle',
      rotate: -90,
    },
  ];
  const dot = Math.max(1.2, Math.min(sx, sy));
  for (const [i, j] of dots) {
    shapes.push({ kind: 'rect', x: pad + j * sx, y: pad + i * sy, w: dot, h: dot, fill: 'ink', stroke: 'none' });
  }
  return { width: size + pad + 10, height: size + pad + 10, shapes };
}
