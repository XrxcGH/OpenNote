// Changes to a drafting document, each a pure function from a document to a new one, and the undo history. A finished
// change (a line drawn, an endpoint moved, a dimension placed) is one step in the history, so one undo takes back the
// geometry and the dimension together.
import {
  MAX_DIMS,
  MAX_ENTITIES,
  anchors,
  dist,
  findEntity,
  rectCorners,
  type DraftingDoc,
  type Dim,
  type Entity,
  type LineType,
  type Pt,
  type Ref,
} from './model';

export type NewEntity =
  | { k: 'line'; a: Pt; b: Pt; lt: LineType }
  | { k: 'rect'; a: Pt; b: Pt; lt: LineType }
  | { k: 'circle'; c: Pt; r: number; lt: LineType }
  | { k: 'arc'; c: Pt; r: number; a0: number; a1: number; lt: LineType }
  | { k: 'poly'; pts: readonly Pt[]; closed: boolean; lt: LineType }
  | { k: 'note'; p: Pt; text: string }
  | { k: 'hatch'; of: string; spacing: number; angle: number };

export type NewDim =
  | { k: 'linear'; a: Ref; b: Ref; axis: 'h' | 'v'; off: number }
  | { k: 'aligned'; a: Ref; b: Ref; off: number }
  | { k: 'angular'; l1: string; l2: string; r: number }
  | { k: 'radius' | 'diameter'; of: string; ang: number };

/** An id no entity or dimension uses yet. */
export function freshId(doc: DraftingDoc, prefix: string): string {
  const used = new Set([...doc.entities.map((e) => e.id), ...doc.dims.map((d) => d.id)]);
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export type AddResult = { ok: true; doc: DraftingDoc; id: string } | { ok: false; problem: 'full' | 'tooSmall' };

const tooSmall = (e: NewEntity): boolean => {
  switch (e.k) {
    case 'line':
    case 'rect':
      return dist(e.a, e.b) < 1e-6;
    case 'circle':
    case 'arc':
      return !(e.r > 1e-6);
    case 'poly':
      return e.pts.length < 2;
    case 'note':
      return e.text.trim() === '';
    case 'hatch':
      return !(e.spacing > 0);
  }
};

export function addEntity(doc: DraftingDoc, e: NewEntity): AddResult {
  if (doc.entities.length >= MAX_ENTITIES) return { ok: false, problem: 'full' };
  if (tooSmall(e)) return { ok: false, problem: 'tooSmall' };
  const id = freshId(doc, e.k === 'hatch' ? 'h' : 'e');
  return { ok: true, doc: { ...doc, entities: [...doc.entities, { ...e, id } as Entity] }, id };
}

export function addDim(doc: DraftingDoc, d: NewDim): AddResult {
  if (doc.dims.length >= MAX_DIMS) return { ok: false, problem: 'full' };
  const id = freshId(doc, 'd');
  return { ok: true, doc: { ...doc, dims: [...doc.dims, { ...d, id } as Dim] }, id };
}

/** Changes some fields of one entity; its dimensions follow because they refer to it by id. */
export function updateEntity(doc: DraftingDoc, id: string, patch: Partial<Entity>): DraftingDoc {
  return { ...doc, entities: doc.entities.map((e) => (e.id === id ? ({ ...e, ...patch } as Entity) : e)) };
}

export function updateDim(doc: DraftingDoc, id: string, patch: Partial<Dim>): DraftingDoc {
  return { ...doc, dims: doc.dims.map((d) => (d.id === id ? ({ ...d, ...patch } as Dim) : d)) };
}

const refsEntity = (d: Dim, id: string): boolean =>
  d.k === 'linear' || d.k === 'aligned'
    ? ('id' in d.a && d.a.id === id) || ('id' in d.b && d.b.id === id)
    : d.k === 'angular'
      ? d.l1 === id || d.l2 === id
      : d.of === id;

/** Removes an entity or a dimension. Hatching of a removed shape and dimensions that point at it go with it. */
export function remove(doc: DraftingDoc, id: string): DraftingDoc {
  const gone = new Set([id]);
  for (const e of doc.entities) if (e.k === 'hatch' && e.of === id) gone.add(e.id);
  return {
    ...doc,
    entities: doc.entities.filter((e) => !gone.has(e.id)),
    dims: doc.dims.filter((d) => !gone.has(d.id) && ![...gone].some((g) => refsEntity(d, g))),
  };
}

/** A dimension reference for a point: the entity anchor it sits on when there is one, so the dimension follows. */
export function refAt(doc: DraftingDoc, p: Pt): Ref {
  for (const e of doc.entities) {
    for (const a of anchors(e)) if (dist(a.p, p) < 1e-6) return { id: e.id, at: a.at };
  }
  return { x: p[0], y: p[1] };
}

/** The nearest entity within `reach` of a point, for picking with a pen. */
export function pick(doc: DraftingDoc, p: Pt, reach: number): Entity | null {
  let best: Entity | null = null;
  let bestD = reach;
  const consider = (e: Entity, d: number) => {
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  };
  for (const e of doc.entities) {
    switch (e.k) {
      case 'line':
        consider(e, distToSegment(p, e.a, e.b));
        break;
      case 'rect':
      case 'poly': {
        const pts: readonly Pt[] = e.k === 'rect' ? rectCorners(e.a, e.b) : e.pts;
        const closed = e.k === 'rect' || e.closed;
        for (let i = 0; i < (closed ? pts.length : pts.length - 1); i++) {
          consider(e, distToSegment(p, pts[i]!, pts[(i + 1) % pts.length]!));
        }
        break;
      }
      case 'circle':
        consider(e, Math.abs(dist(p, e.c) - e.r));
        break;
      case 'arc':
        consider(e, Math.abs(dist(p, e.c) - e.r));
        break;
      case 'note':
        consider(e, dist(p, e.p));
        break;
      case 'hatch':
        break;
    }
  }
  return best;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The signed offset for an aligned dimension so its line passes through the point `p` (left of a to b is positive). */
export function alignedOffset(a: Pt, b: Pt, p: Pt): number {
  const len = dist(a, b) || 1;
  return ((p[0] - a[0]) * -(b[1] - a[1]) + (p[1] - a[1]) * (b[0] - a[0])) / len;
}

/** Undo and redo over whole documents. A document is small, and each step is one finished change. */
export class History {
  private past: DraftingDoc[] = [];
  private future: DraftingDoc[] = [];
  static readonly LIMIT = 100;

  constructor(public present: DraftingDoc) {}

  /** Make a change; it is one undo step. */
  push(next: DraftingDoc): void {
    if (next === this.present) return;
    this.past.push(this.present);
    if (this.past.length > History.LIMIT) this.past.shift();
    this.present = next;
    this.future = [];
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const before = this.past.pop();
    if (!before) return;
    this.future.push(this.present);
    this.present = before;
  }

  redo(): void {
    const after = this.future.pop();
    if (!after) return;
    this.past.push(this.present);
    this.present = after;
  }
}

export { findEntity };
