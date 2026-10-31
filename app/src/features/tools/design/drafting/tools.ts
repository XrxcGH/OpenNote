// What each drawing tool does with a click: a small state machine over the points picked so far. The editor passes it
// the snapped point of every click and shows the hint it returns, so a tool is plain data and can be tested without a
// canvas.
import { addDim, addEntity, alignedOffset, pick, refAt } from './edit';
import { deg, dist, type DraftingDoc, type LineType, type Pt } from './model';

export const DRAFT_TOOLS = [
  'select',
  'line',
  'rect',
  'circle',
  'arc',
  'poly',
  'note',
  'hatch',
  'dimAligned',
  'dimH',
  'dimV',
  'dimAngle',
  'dimRadius',
  'dimDiameter',
] as const;
export type DraftTool = (typeof DRAFT_TOOLS)[number];

export interface Pending {
  pts: Pt[];
  ids: string[];
}

export const NOTHING: Pending = { pts: [], ids: [] };

/** Words for the line under the canvas: a key under hint.<key> in the strings. */
export type Hint =
  | 'select'
  | 'lineFirst'
  | 'lineSecond'
  | 'rectFirst'
  | 'rectSecond'
  | 'circleCenter'
  | 'circleEdge'
  | 'arcCenter'
  | 'arcStart'
  | 'arcEnd'
  | 'polyNext'
  | 'noteAt'
  | 'hatchPick'
  | 'dimFirst'
  | 'dimSecond'
  | 'dimPlace'
  | 'dimAngleFirst'
  | 'dimAngleSecond'
  | 'dimRound';

export interface StepResult {
  pending: Pending;
  /** The document after a finished change; absent while the shape is still being drawn. */
  doc?: DraftingDoc;
  /** The id of what a click picked or made. */
  selected?: string | null;
  /** The note tool needs text for this point. */
  noteAt?: Pt;
  /** A reason a click did nothing, as a key under problem.<key>. */
  problem?: 'full' | 'tooSmall' | 'nothingThere' | 'notClosed' | 'notRound' | 'notLine';
}

export interface StepOptions {
  lt: LineType;
  /** How close a click must be to a shape to pick it, in millimeters. */
  reach: number;
}

const angleOf = (c: Pt, p: Pt): number => (deg(Math.atan2(p[1] - c[1], p[0] - c[0])) + 360) % 360;

export function hintFor(tool: DraftTool, pending: Pending): Hint {
  const n = pending.pts.length + pending.ids.length;
  switch (tool) {
    case 'select':
      return 'select';
    case 'line':
      return n === 0 ? 'lineFirst' : 'lineSecond';
    case 'rect':
      return n === 0 ? 'rectFirst' : 'rectSecond';
    case 'circle':
      return n === 0 ? 'circleCenter' : 'circleEdge';
    case 'arc':
      return n === 0 ? 'arcCenter' : n === 1 ? 'arcStart' : 'arcEnd';
    case 'poly':
      return 'polyNext';
    case 'note':
      return 'noteAt';
    case 'hatch':
      return 'hatchPick';
    case 'dimAngle':
      return pending.ids.length === 0 ? 'dimAngleFirst' : 'dimAngleSecond';
    case 'dimRadius':
    case 'dimDiameter':
      return 'dimRound';
    default:
      return n === 0 ? 'dimFirst' : n === 1 ? 'dimSecond' : 'dimPlace';
  }
}

function added(result: ReturnType<typeof addEntity>, hold: Pending = NOTHING): StepResult {
  return result.ok
    ? { pending: hold, doc: result.doc, selected: result.id }
    : { pending: NOTHING, problem: result.problem };
}

/** One click of a tool at the snapped point `p`. */
export function click(tool: DraftTool, pending: Pending, p: Pt, doc: DraftingDoc, options: StepOptions): StepResult {
  const lt = options.lt;
  const first = pending.pts[0];
  switch (tool) {
    case 'select': {
      const hit = pick(doc, p, options.reach);
      return { pending: NOTHING, selected: hit ? hit.id : null };
    }
    case 'line':
    case 'rect':
      if (!first) return { pending: { pts: [p], ids: [] } };
      return added(addEntity(doc, { k: tool, a: first, b: p, lt }));
    case 'circle':
      if (!first) return { pending: { pts: [p], ids: [] } };
      return added(addEntity(doc, { k: 'circle', c: first, r: dist(first, p), lt }));
    case 'arc': {
      const [c, s] = pending.pts;
      if (!c) return { pending: { pts: [p], ids: [] } };
      if (!s) return { pending: { pts: [c, p], ids: [] } };
      return added(addEntity(doc, { k: 'arc', c, r: dist(c, s), a0: angleOf(c, s), a1: angleOf(c, p), lt }));
    }
    case 'poly':
      return { pending: { pts: [...pending.pts, p], ids: [] } };
    case 'note':
      return { pending: NOTHING, noteAt: p };
    case 'hatch': {
      const hit = pick(doc, p, options.reach);
      if (!hit) return { pending: NOTHING, problem: 'nothingThere' };
      if (hit.k !== 'circle' && hit.k !== 'rect' && !(hit.k === 'poly' && hit.closed))
        return { pending: NOTHING, problem: 'notClosed' };
      return added(addEntity(doc, { k: 'hatch', of: hit.id, spacing: 2.5, angle: 45 }));
    }
    case 'dimRadius':
    case 'dimDiameter': {
      const hit = pick(doc, p, options.reach);
      if (!hit) return { pending: NOTHING, problem: 'nothingThere' };
      if (hit.k !== 'circle' && hit.k !== 'arc') return { pending: NOTHING, problem: 'notRound' };
      const made = addDim(doc, { k: tool === 'dimRadius' ? 'radius' : 'diameter', of: hit.id, ang: angleOf(hit.c, p) });
      return made.ok ? { pending: NOTHING, doc: made.doc } : { pending: NOTHING, problem: 'full' };
    }
    case 'dimAngle': {
      const hit = pick(doc, p, options.reach);
      if (!hit) return { pending: NOTHING, problem: 'nothingThere' };
      if (hit.k !== 'line') return { pending: pending, problem: 'notLine' };
      const [l1] = pending.ids;
      if (!l1) return { pending: { pts: [], ids: [hit.id] } };
      if (l1 === hit.id) return { pending: pending };
      const made = addDim(doc, { k: 'angular', l1, l2: hit.id, r: 15 });
      return made.ok ? { pending: NOTHING, doc: made.doc } : { pending: NOTHING, problem: 'full' };
    }
    default: {
      // Aligned, horizontal, and vertical dimensions: two points, then where the dimension line goes.
      const [a, b] = pending.pts;
      if (!a) return { pending: { pts: [p], ids: [] } };
      if (!b) {
        if (dist(a, p) < 1e-6) return { pending, problem: 'tooSmall' };
        return { pending: { pts: [a, p], ids: [] } };
      }
      const ra = refAt(doc, a);
      const rb = refAt(doc, b);
      const made =
        tool === 'dimAligned'
          ? addDim(doc, { k: 'aligned', a: ra, b: rb, off: alignedOffset(a, b, p) })
          : tool === 'dimH'
            ? addDim(doc, {
                k: 'linear',
                a: ra,
                b: rb,
                axis: 'h',
                off: p[1] >= (a[1] + b[1]) / 2 ? p[1] - Math.max(a[1], b[1]) : p[1] - Math.min(a[1], b[1]),
              })
            : addDim(doc, {
                k: 'linear',
                a: ra,
                b: rb,
                axis: 'v',
                off: p[0] >= (a[0] + b[0]) / 2 ? p[0] - Math.max(a[0], b[0]) : p[0] - Math.min(a[0], b[0]),
              });
      return made.ok ? { pending: NOTHING, doc: made.doc, selected: made.id } : { pending: NOTHING, problem: 'full' };
    }
  }
}

/** Finishes a polyline from the points clicked, open, or closed. */
export function finishPoly(pending: Pending, doc: DraftingDoc, lt: LineType, closed: boolean): StepResult {
  if (pending.pts.length < 2) return { pending: NOTHING, problem: 'tooSmall' };
  return added(addEntity(doc, { k: 'poly', pts: pending.pts, closed: closed && pending.pts.length > 2, lt }));
}

/** The note tool's second step: text for the point the click chose. */
export function placeNote(doc: DraftingDoc, at: Pt, text: string): StepResult {
  return added(addEntity(doc, { k: 'note', p: at, text }));
}
