// Section properties of a plane area made of parts: rectangles, circles, and thin walls (rectangles laid along a
// centerline segment), each solid or a hole. The sums use the parallel-axis theorem. The principal axes come from
// Mohr's circle of inertia. Q is the first moment of the area above a horizontal cut. The shear center of a
// thin-walled open chain comes from the moment of the shear flow a unit shear makes. x is to the right, y is up,
// and angles turn counterclockwise from x. Everything is in base SI (m, m², m⁴).
import { fail, positive, q, step, type KitStep, type StepValue } from '../kit/types';
import { tidy } from '../kit/numeric';

export type Part =
  | { readonly kind: 'rect'; readonly b: number; readonly h: number; readonly x: number; readonly y: number }
  | { readonly kind: 'circle'; readonly d: number; readonly x: number; readonly y: number }
  | {
      readonly kind: 'wall';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly t: number;
    };

/** A part and whether it is a hole. Rectangles and circles are placed by their centers. */
export type Placed = Part & { readonly hole?: boolean };

interface Own {
  readonly A: number;
  readonly x: number;
  readonly y: number;
  readonly Ix: number;
  readonly Iy: number;
  readonly Ixy: number;
}

/** A part's area, centroid, and second moments about its own centroid, signed for a hole. */
export function own(part: Placed): Own {
  const sign = part.hole ? -1 : 1;
  if (part.kind === 'rect') {
    const { b, h } = part;
    return {
      A: sign * b * h,
      x: part.x,
      y: part.y,
      Ix: (sign * b * h ** 3) / 12,
      Iy: (sign * h * b ** 3) / 12,
      Ixy: 0,
    };
  }
  if (part.kind === 'circle') {
    const I = (sign * Math.PI * part.d ** 4) / 64;
    return { A: (sign * Math.PI * part.d ** 2) / 4, x: part.x, y: part.y, Ix: I, Iy: I, Ixy: 0 };
  }
  const L = Math.hypot(part.x2 - part.x1, part.y2 - part.y1);
  const [c, s] = [(part.x2 - part.x1) / L, (part.y2 - part.y1) / L];
  const along = (part.t * L ** 3) / 12;
  const across = (L * part.t ** 3) / 12;
  return {
    A: sign * L * part.t,
    x: (part.x1 + part.x2) / 2,
    y: (part.y1 + part.y2) / 2,
    Ix: sign * (along * s * s + across * c * c),
    Iy: sign * (along * c * c + across * s * s),
    Ixy: sign * (along - across) * s * c,
  };
}

function checkPart(part: Placed): void {
  if (part.kind === 'rect') {
    positive(part.b, 'b');
    positive(part.h, 'h');
  } else if (part.kind === 'circle') positive(part.d, 'd');
  else {
    positive(part.t, 't');
    if (Math.hypot(part.x2 - part.x1, part.y2 - part.y1) === 0) fail('zeroWall');
  }
  for (const value of Object.values(part)) if (typeof value === 'number' && !Number.isFinite(value)) fail('notFinite');
}

export interface Extent {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

function extent(parts: readonly Placed[]): Extent {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const part of parts) {
    if (part.hole) continue;
    if (part.kind === 'rect') {
      xs.push(part.x - part.b / 2, part.x + part.b / 2);
      ys.push(part.y - part.h / 2, part.y + part.h / 2);
    } else if (part.kind === 'circle') {
      xs.push(part.x - part.d / 2, part.x + part.d / 2);
      ys.push(part.y - part.d / 2, part.y + part.d / 2);
    } else {
      const L = Math.hypot(part.x2 - part.x1, part.y2 - part.y1);
      const [nx, ny] = [(-(part.y2 - part.y1) / L) * (part.t / 2), ((part.x2 - part.x1) / L) * (part.t / 2)];
      for (const [x, y] of [
        [part.x1, part.y1],
        [part.x2, part.y2],
      ]) {
        xs.push(x + nx, x - nx);
        ys.push(y + ny, y - ny);
      }
    }
  }
  return { xMin: Math.min(...xs), xMax: Math.max(...xs), yMin: Math.min(...ys), yMax: Math.max(...ys) };
}

export interface SectionResult {
  readonly A: number;
  readonly xBar: number;
  readonly yBar: number;
  /** Second moments about the centroidal x and y axes, and the product of inertia. */
  readonly Ix: number;
  readonly Iy: number;
  readonly Ixy: number;
  readonly I1: number;
  readonly I2: number;
  /** The angle from x to the axis of I1. */
  readonly thetaP: number;
  readonly rx: number;
  readonly ry: number;
  /** Elastic section moduli to the top, bottom, right, and left extreme fibers. */
  readonly Stop: number;
  readonly Sbottom: number;
  readonly Sright: number;
  readonly Sleft: number;
  readonly extent: Extent;
  /** Each part's own values, then its transfer terms: A dy², A dx², and A dx dy. */
  readonly ownTable: StepValue[][];
  readonly transferTable: StepValue[][];
  readonly steps: KitStep[];
}

export function sectionProperties(parts: readonly Placed[]): SectionResult {
  if (parts.length === 0) fail('noParts');
  parts.forEach(checkPart);
  const owns = parts.map(own);
  const A = owns.reduce((sum, o) => sum + o.A, 0);
  const scale = owns.reduce((sum, o) => sum + Math.abs(o.A), 0);
  if (!(A > 1e-9 * scale)) fail('noArea');
  const Ax = owns.reduce((sum, o) => sum + o.A * o.x, 0);
  const Ay = owns.reduce((sum, o) => sum + o.A * o.y, 0);
  const xBar = Ax / A;
  const yBar = Ay / A;
  const terms = owns.map((o) => ({
    dy2: o.A * (o.y - yBar) ** 2,
    dx2: o.A * (o.x - xBar) ** 2,
    dxy: o.A * (o.x - xBar) * (o.y - yBar),
  }));
  const sum = (f: (o: Own, i: number) => number) => owns.reduce((total, o, i) => total + f(o, i), 0);
  const Ix = sum((o, i) => o.Ix + terms[i].dy2);
  const Iy = sum((o, i) => o.Iy + terms[i].dx2);
  const iScale = Math.abs(Ix) + Math.abs(Iy);
  const Ixy = tidy(
    sum((o, i) => o.Ixy + terms[i].dxy),
    iScale,
  );
  if (!(Ix > 0 && Iy > 0)) fail('noArea');
  const mid = (Ix + Iy) / 2;
  const R = Math.hypot((Ix - Iy) / 2, Ixy);
  const thetaP = R < 1e-12 * iScale ? 0 : Math.atan2(-2 * Ixy, Ix - Iy) / 2;
  const box = extent(parts);
  const steps = sectionSteps({ A, Ax, Ay, xBar, yBar, Ix, Iy, Ixy, I1: mid + R, I2: mid - R, thetaP });
  const ownTable: StepValue[][] = owns.map((o) => [
    q(o.A, 'area'),
    q(o.x, 'length'),
    q(o.y, 'length'),
    q(o.Ix, 'inertia'),
    q(o.Iy, 'inertia'),
    q(tidy(o.Ixy, Math.abs(o.Ix) + Math.abs(o.Iy)), 'inertia'),
  ]);
  const transferTable: StepValue[][] = terms.map((t) => [
    q(t.dy2, 'inertia'),
    q(t.dx2, 'inertia'),
    q(tidy(t.dxy, iScale), 'inertia'),
  ]);
  return {
    A,
    xBar,
    yBar,
    Ix,
    Iy,
    Ixy,
    I1: mid + R,
    I2: mid - R,
    thetaP,
    rx: Math.sqrt(Ix / A),
    ry: Math.sqrt(Iy / A),
    Stop: Ix / (box.yMax - yBar),
    Sbottom: Ix / (yBar - box.yMin),
    Sright: Iy / (box.xMax - xBar),
    Sleft: Iy / (xBar - box.xMin),
    extent: box,
    ownTable,
    transferTable,
    steps,
  };
}

interface Sums {
  A: number;
  Ax: number;
  Ay: number;
  xBar: number;
  yBar: number;
  Ix: number;
  Iy: number;
  Ixy: number;
  I1: number;
  I2: number;
  thetaP: number;
}

function sectionSteps(s: Sums): KitStep[] {
  return [
    step('sections.area', 'A = \\sum A_i = [[A]]', { A: q(s.A, 'area') }),
    step(
      'sections.centroid',
      '\\bar x = \\frac{\\sum A_i x_i}{A} = [[x]], \\quad \\bar y = \\frac{\\sum A_i y_i}{A} = \\frac{[[Ay]]}{[[A]]} = [[y]]',
      { x: q(s.xBar, 'length'), y: q(s.yBar, 'length'), Ay: q(s.Ay, 'volume'), A: q(s.A, 'area') },
    ),
    step(
      'sections.parallel',
      'I_x = \\sum \\left(\\bar I_{x,i} + A_i d_{y,i}^2\\right) = [[Ix]], \\quad I_y = [[Iy]]',
      {
        Ix: q(s.Ix, 'inertia'),
        Iy: q(s.Iy, 'inertia'),
      },
    ),
    step('sections.product', 'I_{xy} = \\sum \\left(\\bar I_{xy,i} + A_i d_{x,i} d_{y,i}\\right) = [[Ixy]]', {
      Ixy: q(s.Ixy, 'inertia'),
    }),
    step(
      'sections.principal',
      'I_{1,2} = \\frac{I_x + I_y}{2} \\pm \\sqrt{\\left(\\frac{I_x - I_y}{2}\\right)^2 + I_{xy}^2} = [[I1]],\\ [[I2]]',
      { I1: q(s.I1, 'inertia'), I2: q(s.I2, 'inertia') },
    ),
    step('sections.angle', '\\theta_p = \\tfrac12 \\operatorname{atan2}(-2I_{xy},\\ I_x - I_y) = [[t]]', {
      t: q(s.thetaP, 'angle'),
    }),
  ];
}

/**
 * A part's area above y = cut, the height of that area's centroid, and the part's width just below and just above
 * the cut. The two widths differ only where the cut is on an edge of the part.
 */
interface Above {
  readonly A: number;
  readonly y: number;
  readonly below: number;
  readonly above: number;
}

/** The part of a circle above the line y = cut: its area and the height of its centroid. */
function circleAbove(r: number, yc: number, cut: number): Above {
  const d = cut - yc;
  if (d <= -r) return { A: Math.PI * r * r, y: yc, below: 0, above: 0 };
  if (d >= r) return { A: 0, y: cut, below: 0, above: 0 };
  const half = Math.sqrt(r * r - d * d);
  const A = r * r * Math.acos(d / r) - d * half;
  return { A, y: yc + (2 * half ** 3) / (3 * A), below: 2 * half, above: 2 * half };
}

/**
 * Width w over lo < y < hi: just below the cut it counts when lo < cut <= hi, just above when lo <= cut < hi. A cut
 * within a billionth of the part's height of an edge is on that edge, as 100 mm is on an edge at 110 mm − 10 mm.
 */
function sides(w: number, lo: number, hi: number, cut: number) {
  const tol = 1e-9 * (hi - lo);
  const at = Math.abs(cut - lo) <= tol ? lo : Math.abs(cut - hi) <= tol ? hi : cut;
  return { below: at > lo && at <= hi ? w : 0, above: at >= lo && at < hi ? w : 0 };
}

function partAbove(part: Placed, cut: number): Above {
  if (part.kind === 'rect') {
    const [lo, hi] = [part.y - part.h / 2, part.y + part.h / 2];
    const from = Math.max(lo, cut);
    const width = sides(part.b, lo, hi, cut);
    if (from >= hi) return { A: 0, y: cut, ...width };
    return { A: part.b * (hi - from), y: (from + hi) / 2, ...width };
  }
  if (part.kind === 'circle') return circleAbove(part.d / 2, part.y, cut);
  // A thin wall: the length of its centerline above the cut, times its thickness.
  const [yLo, yHi] = [Math.min(part.y1, part.y2), Math.max(part.y1, part.y2)];
  const L = Math.hypot(part.x2 - part.x1, part.y2 - part.y1);
  const none = { below: 0, above: 0 };
  if (yHi === yLo) return yLo > cut ? { A: L * part.t, y: yLo, ...none } : { A: 0, y: cut, ...none };
  const from = Math.max(yLo, cut);
  const width = sides((part.t * L) / (yHi - yLo), yLo, yHi, cut);
  if (from >= yHi) return { A: 0, y: cut, ...width };
  const fraction = (yHi - from) / (yHi - yLo);
  return { A: L * fraction * part.t, y: (from + yHi) / 2, ...width };
}

/**
 * The first moment about the centroidal x axis of the area above y = cut, and the width of the section there. On a
 * line where the width changes, such as the joint of a tee's flange and web, `width` is the smaller of the widths
 * just below and just above, where VQ/(It) is largest, and `below` and `above` give both.
 */
export function firstMoment(
  parts: readonly Placed[],
  cut: number,
  yBar: number,
): { Q: number; width: number; below: number; above: number } {
  let Q = 0;
  let below = 0;
  let above = 0;
  for (const part of parts) {
    const one = partAbove(part, cut);
    const sign = part.hole ? -1 : 1;
    Q += sign * one.A * (one.y - yBar);
    below += sign * one.below;
    above += sign * one.above;
  }
  [below, above] = [Math.max(below, 0), Math.max(above, 0)];
  const positive = [below, above].filter((w) => w > 0);
  return { Q, width: positive.length > 0 ? Math.min(...positive) : 0, below, above };
}

export interface Wall {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly t: number;
}

/**
 * The shear center of a thin-walled open section whose walls join end to end in one chain, from the first wall's
 * free end. It uses thin-wall integrals along the centerlines (t small next to each wall's length).
 */
export function shearCenter(walls: readonly Wall[]): { x: number; y: number; steps: KitStep[] } {
  for (let i = 1; i < walls.length; i += 1) {
    const [a, b] = [walls[i - 1], walls[i]];
    if (Math.hypot(a.x2 - b.x1, a.y2 - b.y1) > 1e-9 * Math.hypot(a.x2 - a.x1, a.y2 - a.y1)) fail('notChain');
  }
  const lengths = walls.map((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
  const At = walls.reduce((sum, w, i) => sum + w.t * lengths[i], 0);
  const xc = walls.reduce((sum, w, i) => sum + (w.t * lengths[i] * (w.x1 + w.x2)) / 2, 0) / At;
  const yc = walls.reduce((sum, w, i) => sum + (w.t * lengths[i] * (w.y1 + w.y2)) / 2, 0) / At;
  // Each wall in centroidal coordinates: start (x, y), direction (c, s), length L.
  const segs = walls.map((w, i) => ({
    x: w.x1 - xc,
    y: w.y1 - yc,
    c: (w.x2 - w.x1) / lengths[i],
    s: (w.y2 - w.y1) / lengths[i],
    L: lengths[i],
    t: w.t,
  }));
  const line = (f: (g: (typeof segs)[number]) => number) => segs.reduce((sum, g) => sum + f(g), 0);
  const Ixx = line((g) => g.t * (g.y ** 2 * g.L + g.y * g.s * g.L ** 2 + (g.s ** 2 * g.L ** 3) / 3));
  const Iyy = line((g) => g.t * (g.x ** 2 * g.L + g.x * g.c * g.L ** 2 + (g.c ** 2 * g.L ** 3) / 3));
  const Ixy = line(
    (g) => g.t * (g.x * g.y * g.L + ((g.x * g.s + g.y * g.c) * g.L ** 2) / 2 + (g.c * g.s * g.L ** 3) / 3),
  );
  const D = Ixx * Iyy - Ixy ** 2;
  if (!(D > 0)) fail('noArea');
  // The moment about the centroid of the shear flow from shear forces Sx and Sy (Megson's open-section formula).
  const moment = (Sx: number, Sy: number) => {
    const a = (Sx * Ixx - Sy * Ixy) / D;
    const b = (Sy * Iyy - Sx * Ixy) / D;
    let q0 = 0;
    let M = 0;
    for (const g of segs) {
      const qInt =
        q0 * g.L -
        a * g.t * ((g.x * g.L ** 2) / 2 + (g.c * g.L ** 3) / 6) -
        b * g.t * ((g.y * g.L ** 2) / 2 + (g.s * g.L ** 3) / 6);
      M += (g.x * g.s - g.y * g.c) * qInt;
      q0 -= a * g.t * (g.x * g.L + (g.c * g.L ** 2) / 2) + b * g.t * (g.y * g.L + (g.s * g.L ** 2) / 2);
    }
    return M;
  };
  const ex = moment(0, 1);
  const ey = -moment(1, 0);
  const steps = [
    step(
      'sections.flow',
      'q(s) = -\\frac{S_y I_{yy} - S_x I_{xy}}{I_{xx}I_{yy} - I_{xy}^2}\\int_0^s t y\\,ds' +
        ' - \\frac{S_x I_{xx} - S_y I_{xy}}{I_{xx}I_{yy} - I_{xy}^2}\\int_0^s t x\\,ds',
    ),
    step('sections.center', 'x_S = \\bar x + \\frac{1}{S_y}\\oint q\\,p\\,ds = [[x]], \\quad y_S = [[y]]', {
      x: q(xc + ex, 'length'),
      y: q(yc + ey, 'length'),
    }),
  ];
  return { x: tidy(xc + ex, Math.abs(xc) + lengths[0]), y: tidy(yc + ey, Math.abs(yc) + lengths[0]), steps };
}
