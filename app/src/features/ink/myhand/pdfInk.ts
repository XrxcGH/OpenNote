// Handwriting in a PDF's drawing, read straight from the page's operators (pdf.js's operator list), never from a
// picture of the page. Apps that export ink as vectors (OneNote does) draw each stroke as one filled outline, in
// the order it was written; some draw it as a line with a pen width. Outlines go to their center lines, lines are kept
// as they are, and the long straight lines of ruled paper are set apart as the page's rules. A page that holds
// pictures says so, so its pictures can be traced instead. The operator list is untrusted: every count is capped,
// and anything that isn't the shape expected is skipped.
import { outlineToStrokes, polylineToStroke } from './trace';
import type { Ring, Traced } from './trace';

/** pdf.js's path commands in a constructPath argument. */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

/** The operator numbers this reader needs, from pdf.js's OPS. */
export interface PdfOps {
  readonly save: number;
  readonly restore: number;
  readonly transform: number;
  readonly setLineWidth: number;
  readonly constructPath: number;
  readonly fill: number;
  readonly eoFill: number;
  readonly fillStroke: number;
  readonly eoFillStroke: number;
  readonly closeFillStroke: number;
  readonly closeEOFillStroke: number;
  readonly stroke: number;
  readonly closeStroke: number;
  readonly paintImageXObject: number;
  readonly paintInlineImageXObject: number;
  readonly paintImageMaskXObject: number;
  readonly paintFormXObjectBegin?: number;
  readonly paintFormXObjectEnd?: number;
}

export interface OperatorList {
  readonly fnArray: ArrayLike<number>;
  readonly argsArray: ArrayLike<unknown>;
}

/** What one page's drawing holds. Positions are in points from the page's top left. */
export interface PageInk {
  readonly strokes: Traced[];
  /** The y of each rule of ruled paper. */
  readonly rules: number[];
  readonly hasPictures: boolean;
  /** Shapes left out because there were too many. */
  readonly truncated: boolean;
}

export const MAX_PATHS_PER_PAGE = 30_000;
const MAX_POINTS_PER_PAGE = 3_000_000;
/** An outline wider than this on average is a filled shape, not a pen stroke (points). */
const MAX_INK_WIDTH = 6;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

const isNumberArray = (v: unknown): v is ArrayLike<number> =>
  (Array.isArray(v) && v.every((n) => typeof n === 'number')) || ArrayBuffer.isView(v);

/** Flattens a path's commands into rings (closed or not) of x, y pairs, with curves cut into short lines. */
export function flattenPath(
  data: ArrayLike<number>,
  m: Matrix,
  budget: { points: number },
): { rings: Ring[]; closed: boolean[] } {
  const rings: Ring[] = [];
  const closed: boolean[] = [];
  let ring: Ring = [];
  let cx = 0;
  let cy = 0;
  const put = (x: number, y: number) => {
    if (budget.points-- <= 0) return;
    ring.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  };
  const finish = (isClosed: boolean) => {
    if (ring.length >= 4) {
      rings.push(ring);
      closed.push(isClosed);
    }
    ring = [];
  };
  for (let i = 0; i < data.length;) {
    const op = data[i];
    if (op === MOVE && i + 2 < data.length) {
      finish(false);
      cx = data[i + 1];
      cy = data[i + 2];
      put(cx, cy);
      i += 3;
    } else if (op === LINE && i + 2 < data.length) {
      cx = data[i + 1];
      cy = data[i + 2];
      put(cx, cy);
      i += 3;
    } else if (op === CURVE && i + 6 < data.length) {
      const [x1, y1, x2, y2, x3, y3] = [data[i + 1], data[i + 2], data[i + 3], data[i + 4], data[i + 5], data[i + 6]];
      const steps = Math.min(16, Math.max(3, Math.ceil(Math.hypot(x3 - cx, y3 - cy) * 1.5)));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const u = 1 - t;
        put(
          u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      [cx, cy] = [x3, y3];
      i += 7;
    } else if (op === QUAD && i + 4 < data.length) {
      const [x1, y1, x2, y2] = [data[i + 1], data[i + 2], data[i + 3], data[i + 4]];
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const u = 1 - t;
        put(u * u * cx + 2 * u * t * x1 + t * t * x2, u * u * cy + 2 * u * t * y1 + t * t * y2);
      }
      [cx, cy] = [x2, y2];
      i += 5;
    } else if (op === CLOSE) {
      finish(true);
      i += 1;
    } else break;
  }
  finish(false);
  return { rings, closed };
}

const boxOf = (rings: readonly Ring[]) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      x0 = Math.min(x0, r[i]);
      x1 = Math.max(x1, r[i]);
      y0 = Math.min(y0, r[i + 1]);
      y1 = Math.max(y1, r[i + 1]);
    }
  }
  return { x0, y0, x1, y1 };
};

/** A straight line across most of the page, level or upright: a rule of the paper, or a table's border. */
function isRule(rings: readonly Ring[], pageWidth: number): number | null {
  if (rings.length !== 1) return null;
  const box = boxOf(rings);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w > pageWidth * 0.4 && h < 1.5) return (box.y0 + box.y1) / 2;
  return null;
}

/**
 * Reads one page's ink from its operator list. `view` is the page's box ([x0, y0, x1, y1] in PDF points), so the
 * result runs from the top left as the page shows.
 */
export function pageInk(list: OperatorList, ops: PdfOps, view: readonly [number, number, number, number]): PageInk {
  const strokes: Traced[] = [];
  const rules: number[] = [];
  let hasPictures = false;
  let truncated = false;
  let ctm: Matrix = IDENTITY;
  let lineWidth = 1;
  const stack: { ctm: Matrix; lineWidth: number }[] = [];
  const budget = { points: MAX_POINTS_PER_PAGE };
  const [vx0, , , vy1] = view;
  const pageWidth = Math.abs(view[2] - view[0]);
  const toPage = (m: Matrix): Matrix => multiply([1, 0, 0, -1, -vx0, vy1], m);
  const fills = new Set([
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  const strokesOps = new Set([ops.stroke, ops.closeStroke]);
  const count = Math.min(list.fnArray.length, list.argsArray.length);
  let paths = 0;
  for (let i = 0; i < count; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown;
    if (stack.length > 512) stack.shift();
    if (fn === ops.save) stack.push({ ctm, lineWidth });
    else if (fn === ops.restore || fn === ops.paintFormXObjectEnd)
      ({ ctm, lineWidth } = stack.pop() ?? { ctm: IDENTITY, lineWidth: 1 });
    else if (fn === ops.paintFormXObjectBegin && Array.isArray(args)) {
      stack.push({ ctm, lineWidth });
      const n = isNumberArray(args[0]) ? (Array.from(args[0]).slice(0, 6) as Matrix) : null;
      if (n && n.length === 6 && n.every(Number.isFinite)) ctm = multiply(ctm, n);
    } else if (fn === ops.transform && isNumberArray(args) && args.length >= 6) {
      const n = Array.from(args).slice(0, 6) as Matrix;
      if (n.every(Number.isFinite)) ctm = multiply(ctm, n);
    } else if (
      fn === ops.setLineWidth &&
      Array.isArray(args) &&
      typeof args[0] === 'number' &&
      Number.isFinite(args[0])
    ) {
      lineWidth = Math.max(0, Math.min(100, args[0]));
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageMaskXObject) {
      hasPictures = true;
    } else if (fn === ops.constructPath && Array.isArray(args)) {
      if (++paths > MAX_PATHS_PER_PAGE || budget.points <= 0) {
        truncated = true;
        continue;
      }
      const [paint, packed] = args as [unknown, unknown];
      const data = Array.isArray(packed) ? packed[0] : packed;
      if (typeof paint !== 'number' || !isNumberArray(data)) continue;
      const m = toPage(ctm);
      const { rings, closed } = flattenPath(data, m, budget);
      if (rings.length === 0) continue;
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      if (strokesOps.has(paint)) {
        const rule = isRule(rings, pageWidth);
        if (rule !== null) {
          rules.push(rule);
          continue;
        }
        rings.forEach((ring, k) => {
          const points = closed[k] ? [...ring, ring[0], ring[1]] : ring;
          strokes.push(polylineToStroke(points, Math.max(0.2, lineWidth * scale)));
        });
      } else if (fills.has(paint)) {
        const box = boxOf(rings);
        if (box.x1 - box.x0 > pageWidth * 0.6) continue;
        let area = 0;
        let length = 0;
        for (const ring of rings) {
          let a = 0;
          for (let k = 0; k + 1 < ring.length; k += 2) {
            const j = (k + 2) % ring.length;
            a += ring[k] * ring[j + 1] - ring[j] * ring[k + 1];
            length += Math.hypot(ring[j] - ring[k], ring[j + 1] - ring[k + 1]);
          }
          area += a / 2;
        }
        const width = length > 0 ? (2 * Math.abs(area)) / length : Infinity;
        if (width > MAX_INK_WIDTH) continue;
        for (const traced of outlineToStrokes(rings)) if (traced.length > 0) strokes.push(traced);
      }
    }
  }
  return {
    strokes,
    rules: [...new Set(rules.map((r) => Math.round(r * 10) / 10))].sort((a, b) => a - b),
    hasPictures,
    truncated,
  };
}
