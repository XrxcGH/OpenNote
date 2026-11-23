// The Border tab's logic: the eight edges of a selection (its four outer sides, the lines inside it, and the two
// diagonals), what the selection has now, and the cell steps that turn one set of edges into another. A border
// belongs to the cell it is a side of (R-SHT-7), so an inside line is written on both cells that share it.
import { styleAt } from '../../sheet/formatTarget';
import type { CellBox, Step } from '../../sheet/formatTarget';
import type { BorderSide, Sheet, StyleChange } from '../../sheet/model';
import type { TableData } from '../../../../editor/schema/specs';

export const EDGES = ['t', 'b', 'l', 'r', 'ih', 'iv', 'dd', 'du'] as const;
export type Edge = (typeof EDGES)[number];
export type Edges = Partial<Record<Edge, BorderSide>>;

/** The line a click draws: a style name and a color (undefined is Automatic). */
export interface Line {
  style: string;
  color?: string;
}

export const sideOf = (line: Line): BorderSide => (line.color === undefined ? { style: line.style } : { ...line });

/** True when the edge exists for the box: inside lines need two rows or two columns. */
export function edgeExists(edge: Edge, box: CellBox): boolean {
  if (edge === 'ih') return box.bottom > box.top;
  if (edge === 'iv') return box.right > box.left;
  return true;
}

const lined = (side: BorderSide | undefined): BorderSide | undefined =>
  side && side.style !== 'none' ? side : undefined;

/** The edges the box has now: a side counts when any cell along it has the line (the table's drawing, look included). */
export function edgesOf(sheet: Sheet, table: TableData, box: CellBox): Edges {
  const edges: Edges = {};
  const take = (edge: Edge, side: BorderSide | undefined) => {
    if (edges[edge] === undefined && lined(side)) edges[edge] = side;
  };
  for (let r = box.top; r <= box.bottom; r++) {
    for (let c = box.left; c <= box.right; c++) {
      const border = styleAt(sheet, table, r, c).border ?? {};
      if (r === box.top) take('t', border.t);
      if (r === box.bottom) take('b', border.b);
      if (c === box.left) take('l', border.l);
      if (c === box.right) take('r', border.r);
      if (r < box.bottom) take('ih', border.b);
      if (c < box.right) take('iv', border.r);
      take('dd', border.dd);
      take('du', border.du);
    }
  }
  for (const key of Object.keys(edges) as Edge[]) if (!edgeExists(key, box)) delete edges[key];
  return edges;
}

/** The preset edge sets of the tab: none, outline, and inside. */
export function presetEdges(preset: 'none' | 'outline' | 'inside', line: Line, box: CellBox, now: Edges): Edges {
  const side = sideOf(line);
  const keep: Edges = { dd: now.dd, du: now.du };
  if (preset === 'none') return {};
  if (preset === 'outline') return clean({ ...keep, ...inside(now), t: side, b: side, l: side, r: side });
  const out: Edges = { ...keep, t: now.t, b: now.b, l: now.l, r: now.r };
  if (edgeExists('ih', box)) out.ih = side;
  if (edgeExists('iv', box)) out.iv = side;
  return clean(out);
}

const inside = (now: Edges): Edges => ({ ih: now.ih, iv: now.iv });

function clean(edges: Edges): Edges {
  const out: Edges = {};
  for (const key of EDGES) if (edges[key] !== undefined) out[key] = edges[key];
  return out;
}

const one = (box: CellBox, change: StyleChange): Step => ({ box, change });
const set = (side: 't' | 'r' | 'b' | 'l' | 'du' | 'dd', value: BorderSide | null): StyleChange => ({
  border: { [side]: value },
});

/** The steps that turn `before` into `after` over the box: only edges that differ are written. */
export function edgeSteps(box: CellBox, before: Edges, after: Edges): Step[] {
  const steps: Step[] = [];
  const same = (a: BorderSide | undefined, b: BorderSide | undefined) => JSON.stringify(a) === JSON.stringify(b);
  for (const edge of EDGES) {
    if (!edgeExists(edge, box) || same(before[edge], after[edge])) continue;
    const value = after[edge] ?? null;
    switch (edge) {
      case 't':
        steps.push(one({ ...box, bottom: box.top }, set('t', value)));
        break;
      case 'b':
        steps.push(one({ ...box, top: box.bottom }, set('b', value)));
        break;
      case 'l':
        steps.push(one({ ...box, right: box.left }, set('l', value)));
        break;
      case 'r':
        steps.push(one({ ...box, left: box.right }, set('r', value)));
        break;
      case 'ih':
        steps.push(one({ ...box, bottom: box.bottom - 1 }, set('b', value)));
        steps.push(one({ ...box, top: box.top + 1 }, set('t', value)));
        break;
      case 'iv':
        steps.push(one({ ...box, right: box.right - 1 }, set('r', value)));
        steps.push(one({ ...box, left: box.left + 1 }, set('l', value)));
        break;
      case 'dd':
        steps.push(one(box, set('dd', value)));
        break;
      case 'du':
        steps.push(one(box, set('du', value)));
        break;
    }
  }
  return steps;
}
