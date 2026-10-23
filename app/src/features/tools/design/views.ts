// Orthographic views of a model built from unit cubes. A cube is {x, y, z} with x to the right, y up and z toward
// the viewer in the front view (third-angle terms: front view looks along -z). Each view is a set of unit squares
// with the visible edges between them, the hidden edges that lie behind a face, and the outline.

export interface Cube {
  x: number;
  y: number;
  z: number;
}

export type ViewName = 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';

export interface Seg {
  /** Endpoints in view units, u to the right and v up. */
  a: [number, number];
  b: [number, number];
  hidden: boolean;
}

export interface View {
  name: ViewName;
  /** Bounding box of the projected squares. */
  width: number;
  height: number;
  segments: Seg[];
}

export const key = (c: Cube): string => `${c.x},${c.y},${c.z}`;

export function toSet(cubes: readonly Cube[]): Set<string> {
  return new Set(cubes.map(key));
}

/** Largest size a model may have: keeps the work small and the picture legible. */
export const MAX_SIZE = 12;

export function inBounds(c: Cube): boolean {
  return [c.x, c.y, c.z].every((n) => Number.isInteger(n) && n >= 0 && n < MAX_SIZE);
}

/**
 * Projection of each view: (u, v) are the picture axes (u right, v up) and `depth` grows away from the viewer, so
 * the nearest cube on a line of sight has the smallest depth. Picture axes follow the usual sheet layout: the top
 * view has the front of the model at the bottom, the bottom view has it at the top.
 */
function basis(name: ViewName): (c: Cube) => { u: number; v: number; depth: number } {
  const last = MAX_SIZE - 1;
  switch (name) {
    case 'front':
      return (c) => ({ u: c.x, v: c.y, depth: last - c.z });
    case 'back':
      return (c) => ({ u: last - c.x, v: c.y, depth: c.z });
    case 'right':
      return (c) => ({ u: last - c.z, v: c.y, depth: last - c.x });
    case 'left':
      return (c) => ({ u: c.z, v: c.y, depth: c.x });
    case 'top':
      return (c) => ({ u: c.x, v: last - c.z, depth: last - c.y });
    case 'bottom':
      return (c) => ({ u: c.x, v: c.z, depth: c.y });
  }
}

/**
 * The depth planes at which an edge of the solid lies on the line between two neighbouring picture cells. Plane j
 * lies between depth layers j - 1 and j. Looking along the line, the four cubes around it form a pattern: all
 * empty or all full has no edge, and two filled cubes side by side (a flat face) has none either; anything else is
 * an edge of the solid.
 */
function edgePlanes(a: Set<number> | undefined, b: Set<number> | undefined): number[] {
  const planes: number[] = [];
  for (let j = 0; j <= MAX_SIZE; j++) {
    const a1 = a?.has(j - 1) ?? false;
    const a2 = a?.has(j) ?? false;
    const b1 = b?.has(j - 1) ?? false;
    const b2 = b?.has(j) ?? false;
    const n = Number(a1) + Number(a2) + Number(b1) + Number(b2);
    if (n === 0 || n === 4) continue;
    if (n === 2 && ((a1 && a2) || (b1 && b2) || (a1 && b1) || (a2 && b2))) continue;
    planes.push(j);
  }
  return planes;
}

/**
 * One view. A line between two neighbouring cells is visible when an edge lies at the front plane of the nearest
 * cube there (a step in the surface or an outline) and hidden when edges exist only farther back (a notch or step
 * behind level faces). Coplanar faces merge, so no line is drawn between them.
 */
export function project(cubes: readonly Cube[], name: ViewName): View {
  if (cubes.length === 0) return { name, width: 0, height: 0, segments: [] };
  const f = basis(name);
  const layers = new Map<string, Set<number>>();
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const c of cubes) {
    const { u, v, depth } = f(c);
    const k = `${u},${v}`;
    let set = layers.get(k);
    if (!set) layers.set(k, (set = new Set()));
    set.add(depth);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const at = (u: number, v: number) => layers.get(`${u},${v}`);
  const near = (s: Set<number> | undefined) => (s ? Math.min(...s) : Infinity);
  const classify = (a: Set<number> | undefined, b: Set<number> | undefined): boolean | null => {
    const planes = edgePlanes(a, b);
    if (planes.length === 0) return null;
    return planes.includes(Math.min(near(a), near(b))) ? false : true;
  };
  const segments: Seg[] = [];
  for (let u = minU; u <= maxU + 1; u++) {
    for (let v = minV; v <= maxV; v++) {
      const hidden = classify(at(u - 1, v), at(u, v));
      if (hidden !== null) segments.push({ a: [u - minU, v - minV], b: [u - minU, v - minV + 1], hidden });
    }
  }
  for (let v = minV; v <= maxV + 1; v++) {
    for (let u = minU; u <= maxU; u++) {
      const hidden = classify(at(u, v - 1), at(u, v));
      if (hidden !== null) segments.push({ a: [u - minU, v - minV], b: [u - minU + 1, v - minV], hidden });
    }
  }
  return { name, width: maxU - minU + 1, height: maxV - minV + 1, segments: merge(segments) };
}

/** Joins unit segments that touch end to end in a line and have the same kind. */
function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  const isVertical = (s: Seg) => s.a[0] === s.b[0];
  for (const vertical of [true, false]) {
    const group = segs
      .filter((s) => isVertical(s) === vertical)
      .sort((p, q) =>
        vertical
          ? p.a[0] - q.a[0] || Number(p.hidden) - Number(q.hidden) || p.a[1] - q.a[1]
          : p.a[1] - q.a[1] || Number(p.hidden) - Number(q.hidden) || p.a[0] - q.a[0],
      );
    let cur: Seg | null = null;
    for (const s of group) {
      const joins = cur !== null && cur.hidden === s.hidden && cur.b[0] === s.a[0] && cur.b[1] === s.a[1];
      if (cur && joins) {
        cur.b = s.b;
      } else {
        cur = { a: [...s.a], b: [...s.b], hidden: s.hidden };
        out.push(cur);
      }
    }
  }
  return out;
}

export type Projection = 'third' | 'first';

/**
 * The three standard views placed in a layout. Third angle: top above front, right to the right of front.
 * First angle: top below front, right to the left of front.
 */
export function standardViews(
  cubes: readonly Cube[],
  system: Projection,
): { front: View; top: View; right: View; system: Projection } {
  return { front: project(cubes, 'front'), top: project(cubes, 'top'), right: project(cubes, 'right'), system };
}

/** Isometric position of a cube corner on screen: x goes right-down, z goes left-down, y up (unit edge = 1). */
export function iso(x: number, y: number, z: number): [number, number] {
  const c = Math.cos(Math.PI / 6);
  const s = 0.5;
  return [(x - z) * c, (x + z) * s + y];
}

export interface IsoFace {
  points: [number, number][];
  /** 0 top, 1 left face, 2 right face: used to pick a shade. */
  shade: 0 | 1 | 2;
  /** Painter order: larger draws later (nearer). */
  order: number;
}

/** Visible faces of the model seen from the +x, +y, +z corner, in painter order. */
export function isoFaces(cubes: readonly Cube[]): IsoFace[] {
  const set = toSet(cubes);
  const faces: IsoFace[] = [];
  for (const { x, y, z } of cubes) {
    const order = x + y + z;
    if (!set.has(`${x},${y + 1},${z}`)) {
      faces.push({
        shade: 0,
        order,
        points: [iso(x, y + 1, z), iso(x + 1, y + 1, z), iso(x + 1, y + 1, z + 1), iso(x, y + 1, z + 1)],
      });
    }
    // The face toward +z is on the left of the screen; toward +x on the right.
    if (!set.has(`${x},${y},${z + 1}`)) {
      faces.push({
        shade: 1,
        order,
        points: [iso(x, y, z + 1), iso(x + 1, y, z + 1), iso(x + 1, y + 1, z + 1), iso(x, y + 1, z + 1)],
      });
    }
    if (!set.has(`${x + 1},${y},${z}`)) {
      faces.push({
        shade: 2,
        order,
        points: [iso(x + 1, y, z), iso(x + 1, y, z + 1), iso(x + 1, y + 1, z + 1), iso(x + 1, y + 1, z)],
      });
    }
  }
  return faces.sort((a, b) => a.order - b.order);
}
