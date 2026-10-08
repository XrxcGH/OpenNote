// The lines of a page's paper as a lattice: where ruled, grid, and dot paper draw their lines, in page units. The
// paper renderer (features/pages/paper/patterns.ts) draws from it and the drawing tools snap to it, so a point that
// snaps sits exactly on a line the page shows, on every sheet and at every zoom. It is pure arithmetic, shared by
// the page view, print, and the ink view without either importing the other.

/** A box in page units. */
export interface LatticeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface LatticePoint {
  readonly x: number;
  readonly y: number;
}

export type LatticeKind = 'ruled' | 'grid' | 'dots';

/**
 * The lines of ruled, grid, or dot paper. Horizontal lines are at `origin.y + j * step` and, on grid and dot paper,
 * vertical lines at `origin.x + i * step`; dot paper has a dot where they cross. On a paginated page the lattice
 * starts again on every sheet, `sheet` page units further down.
 */
export interface PaperLattice {
  readonly kind: LatticeKind;
  /** The distance between two lines, in page units. */
  readonly step: number;
  /** A crossing of the lattice: the left and top margins. */
  readonly origin: LatticePoint;
  /** Where one sheet draws its lines, from the sheet's top-left corner, or where the whole page draws them. */
  readonly area: LatticeRect;
  /** The height of a sheet when the page is paginated, or null for one long page. */
  readonly sheet: number | null;
  /** The y of the first line below the page's title band, when it has one: the first sheet has no lines above it. */
  readonly from?: number;
  /** The x of ruled paper's margin line, which runs the whole height of the page, or null when it has none. */
  readonly margin: number | null;
}

/** Tolerance for a line at the edge of the area, in page units: the renderer's own (pagination/geometry.ts EPS). */
export const LATTICE_EPS = 0.01;

/** An area that has no edges, for a page with no sheets. Finite, so its edges stay ordinary numbers. */
export const UNBOUNDED: LatticeRect = { x: -1e7, y: -1e7, w: 2e7, h: 2e7 };

/**
 * The box with everything above `from` cut off, or the box itself when `from` is not given. A page's title and its
 * date sit in a header the rules leave blank: the rules (and the squares and dots) of the first sheet begin at `from`.
 */
export function below(box: LatticeRect, from: number | undefined): LatticeRect {
  if (from === undefined || from <= box.y) return box;
  const y = Math.min(from, box.y + box.h);
  return { ...box, y, h: box.y + box.h - y };
}

/** The part of `a` inside `b`. An empty overlap is a box of no size at the nearer edge. */
export function intersect(a: LatticeRect, b: LatticeRect): LatticeRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x: Math.min(x, right), y: Math.min(y, bottom), w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** The sheet that holds `y`, from 0, or 0 on a page with no sheets. */
export function sheetIndex(lattice: PaperLattice, y: number): number {
  return lattice.sheet === null ? 0 : Math.max(0, Math.floor((y + LATTICE_EPS) / lattice.sheet));
}

/** Where sheet `k` draws its lines, in page units: its area moved down to the sheet, below the header on sheet 0. */
export function linesArea(lattice: PaperLattice, k: number): LatticeRect {
  const dy = lattice.sheet === null ? 0 : k * lattice.sheet;
  const area = { ...lattice.area, y: lattice.area.y + dy };
  return k === 0 ? below(area, lattice.from) : area;
}

/** The y of rule 0 on sheet `k`: the lattice's origin, moved down to the sheet. */
export function sheetOriginY(lattice: PaperLattice, k: number): number {
  return lattice.origin.y + (lattice.sheet === null ? 0 : k * lattice.sheet);
}

/**
 * The line nearest `v` of the lines at `origin + k * step` that lie within [lo, hi], or null when none does. The
 * same arithmetic as the renderer's `ticks`, so the line it gives is one the renderer draws.
 */
export function nearestLine(v: number, origin: number, step: number, lo: number, hi: number): number | null {
  if (!(step > 0) || !(hi >= lo)) return null;
  const first = Math.ceil((lo - origin - LATTICE_EPS) / step);
  const last = Math.floor((hi - origin + LATTICE_EPS) / step);
  if (last < first) return null;
  const k = Math.min(last, Math.max(first, Math.round((v - origin) / step)));
  return origin + k * step;
}

/** How far a point reaches for a line: a third of the spacing, at least `minPx` screen pixels, at most half. */
export function snapReach(step: number, zoom: number, minPx = 6): number {
  return Math.min(step / 2, Math.max(step / 3, minPx / Math.max(zoom, 1e-3)));
}

/** A point after snapping: where it went, and which of its coordinates now lie on a line. */
export interface LatticeSnap {
  readonly point: LatticePoint;
  readonly x: boolean;
  readonly y: boolean;
}

interface AxisHit {
  readonly value: number;
  readonly distance: number;
  /** Where the line is drawn along its length: x for a row, y for a column. */
  readonly span: readonly [number, number];
}

const inSpan = (v: number, [lo, hi]: readonly [number, number]) => v >= lo - LATTICE_EPS && v <= hi + LATTICE_EPS;

const closer = (a: AxisHit | null, b: AxisHit | null): AxisHit | null =>
  !a ? b : !b ? a : b.distance < a.distance ? b : a;

/** The horizontal line of sheet `k` within `reach` of `p`, where that line is drawn under `p`. */
function rowHit(lattice: PaperLattice, k: number, p: LatticePoint, reach: number): AxisHit | null {
  const area = linesArea(lattice, k);
  if (p.x < area.x - reach || p.x > area.x + area.w + reach) return null;
  const y = nearestLine(p.y, sheetOriginY(lattice, k), lattice.step, area.y, area.y + area.h);
  if (y === null || Math.abs(y - p.y) > reach) return null;
  return { value: y, distance: Math.abs(y - p.y), span: [area.x, area.x + area.w] };
}

/** The vertical line of sheet `k` within `reach` of `p`, where that line is drawn beside `p`. */
function columnHit(lattice: PaperLattice, k: number, p: LatticePoint, reach: number): AxisHit | null {
  const area = linesArea(lattice, k);
  if (p.y < area.y - reach || p.y > area.y + area.h + reach) return null;
  const x = nearestLine(p.x, lattice.origin.x, lattice.step, area.x, area.x + area.w);
  if (x === null || Math.abs(x - p.x) > reach) return null;
  return { value: x, distance: Math.abs(x - p.x), span: [area.y, area.y + area.h] };
}

/** The sheets whose lines can be within reach of `y`: its own and the ones next to it. */
function nearSheets(lattice: PaperLattice, y: number): number[] {
  if (lattice.sheet === null) return [0];
  const k = sheetIndex(lattice, y);
  return [k - 1, k, k + 1].filter((s) => s >= 0);
}

/**
 * A point snapped to the paper's lines within `reach` page units. Grid paper snaps each coordinate to its nearest
 * line, so a point near a crossing lands on it. Dot paper snaps to a dot when both coordinates are within reach of
 * one. Ruled paper snaps y to its nearest rule, and x to the margin line when one is drawn.
 */
export function snapToLattice(lattice: PaperLattice, p: LatticePoint, reach: number): LatticeSnap {
  if (lattice.kind === 'dots') return snapToDot(lattice, p, reach);
  let row: AxisHit | null = null;
  let column: AxisHit | null = null;
  for (const k of nearSheets(lattice, p.y)) {
    row = closer(row, rowHit(lattice, k, p, reach));
    if (lattice.kind === 'grid') column = closer(column, columnHit(lattice, k, p, reach));
  }
  if (lattice.kind === 'ruled' && lattice.margin !== null && Math.abs(p.x - lattice.margin) <= reach) {
    column = { value: lattice.margin, distance: Math.abs(p.x - lattice.margin), span: [0, Infinity] };
  }
  // A coordinate snaps only where its line is drawn under the point it makes: near the end of a line, the point
  // keeps the other coordinate it had, and the line's end must reach it.
  let x = column ? column.value : p.x;
  let y = row ? row.value : p.y;
  if (column && !inSpan(y, column.span)) {
    column = null;
    x = p.x;
  }
  if (row && !inSpan(x, row.span)) {
    row = null;
    y = p.y;
  }
  if (column && !inSpan(y, column.span)) {
    column = null;
    x = p.x;
  }
  return { point: { x, y }, x: column !== null, y: row !== null };
}

/** The dot nearest `p`, where both its row and its column are within reach and drawn on the same sheet. */
function snapToDot(lattice: PaperLattice, p: LatticePoint, reach: number): LatticeSnap {
  let best: { point: LatticePoint; distance: number } | null = null;
  for (const k of nearSheets(lattice, p.y)) {
    const row = rowHit(lattice, k, p, reach);
    const column = columnHit(lattice, k, p, reach);
    if (!row || !column) continue;
    const distance = Math.hypot(row.distance, column.distance);
    if (!best || distance < best.distance) best = { point: { x: column.value, y: row.value }, distance };
  }
  return best ? { point: best.point, x: true, y: true } : { point: p, x: false, y: false };
}

/** The horizontal line nearest `p` within `reach`, where one is drawn under `p`; or null. */
export function nearestRow(lattice: PaperLattice, p: LatticePoint, reach: number): number | null {
  let best: AxisHit | null = null;
  for (const k of nearSheets(lattice, p.y)) best = closer(best, rowHit(lattice, k, p, reach));
  return best ? best.value : null;
}

/**
 * How far to move `v` so it lands on the next line in `direction`: on a line, the one a step on; between two, the
 * one it is moving toward. `axis` says which lines: 'x' for vertical lines and 'y' for horizontal ones, which start
 * again on each sheet. Ruled paper has no vertical lines but its margin, so along x it moves one whole step.
 */
export function stepToLine(lattice: PaperLattice, v: number, axis: 'x' | 'y', direction: 1 | -1, at: number): number {
  const { step } = lattice;
  if (axis === 'x' && lattice.kind === 'ruled') return direction * step;
  const origin = axis === 'x' ? lattice.origin.x : sheetOriginY(lattice, sheetIndex(lattice, at));
  const t = (v - origin) / step;
  const tolerance = LATTICE_EPS / step;
  const next = direction === 1 ? Math.floor(t + tolerance) + 1 : Math.ceil(t - tolerance) - 1;
  return origin + next * step - v;
}
