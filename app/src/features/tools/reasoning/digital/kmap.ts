// Karnaugh maps for 1 to 6 variables. Rows and columns run in Gray code, so neighbors differ in one variable. Five
// variables draw as two 4-variable maps and six as four. Each group of the chosen cover is outlined and numbered,
// wrapping around the edges where the group does.
import { el, label, round, svgRoot } from '../core/svg';
import type { SvgNode, Tone } from '../core/svg';
import { covers } from './qm';
import type { Cube } from './qm';

const gray = (i: number): number => i ^ (i >> 1);
const CELL = 38;
const TONES: readonly Tone[] = ['accent', 'hi', 'warn'];

export interface MapShape {
  mapBits: number;
  rowBits: number;
  colBits: number;
}

export function shapeOf(n: number): MapShape {
  const mapBits = Math.max(0, n - 4);
  const inner = n - mapBits;
  const rowBits = Math.floor(inner / 2);
  return { mapBits, rowBits, colBits: inner - rowBits };
}

/** The minterm in map `m`, row `r`, column `c` (display positions). */
export function cellTerm(shape: MapShape, m: number, r: number, c: number): number {
  return (gray(m) << (shape.rowBits + shape.colBits)) | (gray(r) << shape.colBits) | gray(c);
}

function runs(indices: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of [...indices].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

const bitsText = (value: number, count: number): string => (count === 0 ? '' : value.toString(2).padStart(count, '0'));

export function kmapFigure(
  vars: readonly string[],
  ons: readonly number[],
  dcs: readonly number[],
  groups: readonly Cube[],
): SvgNode {
  const n = vars.length;
  const shape = shapeOf(n);
  const rows = 1 << shape.rowBits;
  const cols = 1 << shape.colBits;
  const maps = 1 << shape.mapBits;
  const on = new Set(ons);
  const dc = new Set(dcs);
  const mapW = cols * CELL + 50;
  const mapH = rows * CELL + 60;
  const rowName = vars.slice(shape.mapBits, shape.mapBits + shape.rowBits).join('');
  const colName = vars.slice(shape.mapBits + shape.rowBits).join('');
  const parts: SvgNode[] = [];
  for (let m = 0; m < maps; m += 1) {
    const ox = 10 + m * (mapW + 20);
    const oy = shape.mapBits ? 22 : 6;
    if (shape.mapBits)
      parts.push(
        label(
          ox + 40 + (cols * CELL) / 2,
          10,
          `${vars.slice(0, shape.mapBits).join('')} = ${bitsText(gray(m), shape.mapBits)}`,
        ),
      );
    parts.push(label(ox + 20, oy + 14, `${rowName}\\${colName}`, { fontSize: 11, fill: '@muted' }));
    for (let c = 0; c < cols; c += 1)
      parts.push(label(ox + 40 + c * CELL + CELL / 2, oy + 14, bitsText(gray(c), shape.colBits), { fontSize: 11 }));
    for (let r = 0; r < rows; r += 1) {
      parts.push(
        label(ox + 20, oy + 30 + r * CELL + CELL / 2, bitsText(gray(r), shape.rowBits) || '·', { fontSize: 11 }),
      );
      for (let c = 0; c < cols; c += 1) {
        const term = cellTerm(shape, m, r, c);
        const x = ox + 40 + c * CELL;
        const y = oy + 30 + r * CELL;
        parts.push(
          el('rect', { x, y, width: CELL, height: CELL, fill: '@paper', stroke: '@line' }),
          label(x + CELL / 2, y + CELL / 2 + 2, on.has(term) ? '1' : dc.has(term) ? 'X' : '0', {
            fill: on.has(term) ? '@ink' : '@muted',
            fontSize: 14,
          }),
          label(x + CELL - 8, y + 8, String(term), { fontSize: 8, fill: '@muted' }),
        );
      }
    }
    groups.forEach((g, gi) => {
      const cells: [number, number][] = [];
      for (let r = 0; r < rows; r += 1)
        for (let c = 0; c < cols; c += 1) if (covers(g, cellTerm(shape, m, r, c))) cells.push([r, c]);
      if (cells.length === 0) return;
      const rset = [...new Set(cells.map(([r]) => r))];
      const cset = [...new Set(cells.map(([, c]) => c))];
      const inset = 3 + (gi % 4) * 3;
      const tone = TONES[gi % TONES.length];
      for (const [r0, r1] of runs(rset))
        for (const [c0, c1] of runs(cset)) {
          const x = ox + 40 + c0 * CELL + inset;
          const y = oy + 30 + r0 * CELL + inset;
          parts.push(
            el('rect', {
              x: round(x),
              y: round(y),
              width: round((c1 - c0 + 1) * CELL - 2 * inset),
              height: round((r1 - r0 + 1) * CELL - 2 * inset),
              rx: 9,
              fill: 'none',
              stroke: `@${tone}`,
              strokeWidth: 2,
            }),
            label(x + 5, y + 6, String(gi + 1), { fontSize: 9, fill: `@${tone}`, fontWeight: 700 }),
          );
        }
    });
  }
  return svgRoot(maps * (mapW + 20) + 10, mapH + (shape.mapBits ? 22 : 6), ...parts);
}
