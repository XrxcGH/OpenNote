// Pressure vessels, fits, and curved beams. Thin walls carry pr/t round the hoop and half of it along a closed
// cylinder. Thick cylinders follow Lamé: σr = A − B/r² and σθ = A + B/r², with A and B from the pressures at the two
// faces. A press or shrink fit's pressure makes the hub's bore grow and the shaft shrink by the interference
// between them. A curved beam's neutral axis is at rn = A/∫dA/r (Winkler), inside the centroid. Tension is
// positive, as is a pressure that pushes on a face. Everything is in base SI.
import { fail, finite, notNegative, positive, q, step, type KitStep } from '../kit/types';

const has = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

export interface ThinResult {
  readonly hoop: number;
  readonly axial: number;
  readonly radial: number;
  readonly ratio: number;
  readonly steps: KitStep[];
}

/** A thin-walled closed cylinder or sphere of mean radius r. */
export function thinVessel(shape: 'cylinder' | 'sphere', p: number, r: number, t: number): ThinResult {
  finite(p, 'p');
  positive(r, 'r');
  positive(t, 't');
  if (t >= r) fail('tooThick');
  const hoop = shape === 'sphere' ? (p * r) / (2 * t) : (p * r) / t;
  const axial = (p * r) / (2 * t);
  const steps =
    shape === 'sphere'
      ? [
          step('vessels.sphere', '\\sigma = \\frac{p r}{2 t} = \\frac{[[p]] \\times [[r]]}{2 \\times [[t]]} = [[s]]', {
            p: q(p, 'stress'),
            r: q(r, 'length'),
            t: q(t, 'length'),
            s: q(hoop, 'stress'),
          }),
        ]
      : [
          step('vessels.hoop', '\\sigma_\\theta = \\frac{p r}{t} = \\frac{[[p]] \\times [[r]]}{[[t]]} = [[s]]', {
            p: q(p, 'stress'),
            r: q(r, 'length'),
            t: q(t, 'length'),
            s: q(hoop, 'stress'),
          }),
          step('vessels.axial', '\\sigma_a = \\frac{p r}{2 t} = [[s]]', { s: q(axial, 'stress') }),
        ];
  return { hoop, axial, radial: -p, ratio: t / r, steps };
}

export interface LameInput {
  readonly ri: number;
  readonly ro: number;
  readonly pi: number;
  readonly po: number;
  readonly ends: 'closed' | 'open';
  readonly E?: number;
  readonly nu?: number;
}

export interface LameResult {
  readonly A: number;
  readonly B: number;
  readonly axial: number;
  readonly radial: (r: number) => number;
  readonly hoop: (r: number) => number;
  /** Radial displacement, when E and ν are given. */
  readonly u?: (r: number) => number;
  readonly steps: KitStep[];
}

export function thickCylinder(input: LameInput): LameResult {
  const ri = notNegative(input.ri, 'r_i');
  const ro = positive(input.ro, 'r_o');
  if (ri >= ro) fail('innerRadius');
  const pi = finite(input.pi, 'p_i');
  const po = finite(input.po, 'p_o');
  if (ri === 0 && pi !== 0) fail('solidInnerPressure');
  const d = ro * ro - ri * ri;
  const A = (pi * ri * ri - po * ro * ro) / d;
  const B = ((pi - po) * ri * ri * ro * ro) / d;
  const axial = input.ends === 'closed' ? A : 0;
  const radial = (r: number) => A - B / (r * r);
  const hoop = (r: number) => A + B / (r * r);
  const steps = [
    step(
      'vessels.lameConstants',
      'A = \\frac{p_i r_i^2 - p_o r_o^2}{r_o^2 - r_i^2} = [[A]], \\quad B = \\frac{(p_i - p_o) r_i^2 r_o^2}{r_o^2 - r_i^2}',
      { A: q(A, 'stress') },
    ),
    step('vessels.lame', '\\sigma_r = A - \\frac{B}{r^2}, \\quad \\sigma_\\theta = A + \\frac{B}{r^2}'),
    step(
      'vessels.faces',
      '\\sigma_\\theta(r_i) = [[hi]], \\quad \\sigma_r(r_i) = [[ri]], \\quad \\sigma_\\theta(r_o) = [[ho]], \\quad \\sigma_r(r_o) = [[ro]]',
      {
        hi: q(ri > 0 ? hoop(ri) : A, 'stress'),
        ri: q(ri > 0 ? radial(ri) : A, 'stress'),
        ho: q(hoop(ro), 'stress'),
        ro: q(radial(ro), 'stress'),
      },
    ),
    step(
      input.ends === 'closed' ? 'vessels.closedEnds' : 'vessels.openEnds',
      input.ends === 'closed'
        ? '\\sigma_a = \\frac{p_i r_i^2 - p_o r_o^2}{r_o^2 - r_i^2} = A = [[a]]'
        : '\\sigma_a = 0',
      { a: q(axial, 'stress') },
    ),
  ];
  if (!has(input.E)) return { A, B, axial, radial, hoop, steps };
  const E = positive(input.E, 'E');
  const nu = has(input.nu) ? input.nu : 0.3;
  if (nu <= -1 || nu >= 0.5) fail('poisson');
  const u = (r: number) => (r / E) * ((r === 0 ? A : hoop(r)) - nu * ((r === 0 ? A : radial(r)) + axial));
  steps.push(
    step('vessels.displacement', 'u = \\frac{r}{E}\\left[\\sigma_\\theta - \\nu(\\sigma_r + \\sigma_a)\\right]'),
  );
  return { A, B, axial, radial, hoop, u, steps };
}

export interface FitInput {
  /** The shaft's bore (0 for a solid shaft), the common radius, and the hub's outside radius. */
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** Radial interference: the shaft's radius less the hub bore's, before assembly. */
  readonly delta: number;
  readonly Ei: number;
  readonly nui: number;
  readonly Eo: number;
  readonly nuo: number;
  readonly mu?: number;
  readonly length?: number;
  readonly alpha?: number;
}

export interface FitResult {
  readonly p: number;
  readonly hubBore: number;
  readonly hubOutside: number;
  readonly shaftSurface: number;
  readonly shaftInside: number;
  readonly hubGrows: number;
  readonly shaftShrinks: number;
  readonly torque?: number;
  readonly heat?: number;
  readonly steps: KitStep[];
}

export function shrinkFit(input: FitInput): FitResult {
  const a = notNegative(input.a, 'a');
  const b = positive(input.b, 'b');
  const c = positive(input.c, 'c');
  if (!(a < b && b < c)) fail('fitRadii');
  const delta = positive(input.delta, 'δ');
  const Ei = positive(input.Ei, 'E_i');
  const Eo = positive(input.Eo, 'E_o');
  for (const nu of [input.nui, input.nuo]) if (!(nu > -1 && nu < 0.5)) fail('poisson');
  const hubTerm = (b / Eo) * ((c * c + b * b) / (c * c - b * b) + input.nuo);
  const shaftTerm = (b / Ei) * ((b * b + a * a) / (b * b - a * a) - input.nui);
  const p = delta / (hubTerm + shaftTerm);
  const hubBore = (p * (c * c + b * b)) / (c * c - b * b);
  const hubOutside = (2 * p * b * b) / (c * c - b * b);
  const shaftSurface = (-p * (b * b + a * a)) / (b * b - a * a);
  // A solid shaft is under −p all through; a bored one has the larger hoop stress at its bore.
  const shaftInside = a === 0 ? -p : (-2 * p * b * b) / (b * b - a * a);
  const steps: KitStep[] = [
    step(
      'vessels.fitCompat',
      '\\delta = u_{hub}(b) - u_{shaft}(b) = p\\,\\frac{b}{E_o}\\left(\\frac{c^2 + b^2}{c^2 - b^2} + \\nu_o\\right) + ' +
        'p\\,\\frac{b}{E_i}\\left(\\frac{b^2 + a^2}{b^2 - a^2} - \\nu_i\\right)',
    ),
    step('vessels.fitPressure', 'p = [[p]]', { p: q(p, 'stress') }),
    step(
      'vessels.fitHub',
      '\\sigma_{\\theta,hub}(b) = p\\,\\frac{c^2 + b^2}{c^2 - b^2} = [[h]], \\quad \\sigma_{\\theta,hub}(c) = [[ho]]',
      { h: q(hubBore, 'stress'), ho: q(hubOutside, 'stress') },
    ),
    step('vessels.fitShaft', '\\sigma_{\\theta,shaft}(b) = -p\\,\\frac{b^2 + a^2}{b^2 - a^2} = [[s]]', {
      s: q(shaftSurface, 'stress'),
    }),
  ];
  let torque: number | undefined;
  if (has(input.mu) && has(input.length)) {
    torque = 2 * Math.PI * notNegative(input.mu, 'μ') * p * b * b * positive(input.length, 'l');
    steps.push(step('vessels.fitTorque', 'T = 2\\pi \\mu p b^2 l = [[T]]', { T: q(torque, 'smallMoment') }));
  }
  let heat: number | undefined;
  if (has(input.alpha)) {
    heat = delta / (positive(input.alpha, 'α') * b);
    steps.push(
      step('vessels.fitHeat', '\\Delta T = \\frac{\\delta}{\\alpha b} = [[dT]]', { dT: q(heat, 'tempChange') }),
    );
  }
  return {
    p,
    hubBore,
    hubOutside,
    shaftSurface,
    shaftInside,
    hubGrows: p * hubTerm,
    shaftShrinks: p * shaftTerm,
    ...(torque === undefined ? {} : { torque }),
    ...(heat === undefined ? {} : { heat }),
    steps,
  };
}

/** A rectangle of width b from radius r1 to radius r2, as a curved beam's section is built. */
export interface Strip {
  readonly b: number;
  readonly r1: number;
  readonly r2: number;
}

export type CurvedSection =
  | { readonly kind: 'strips'; readonly strips: readonly Strip[] }
  | { readonly kind: 'circle'; readonly d: number; readonly rc: number };

export interface CurvedResult {
  readonly A: number;
  readonly rc: number;
  readonly rn: number;
  readonly e: number;
  readonly ri: number;
  readonly ro: number;
  readonly inner: number;
  readonly outer: number;
  readonly straightInner: number;
  readonly straightOuter: number;
  readonly stress: (r: number) => number;
  readonly straight: (r: number) => number;
  readonly steps: KitStep[];
}

function sectionSums(section: CurvedSection) {
  if (section.kind === 'circle') {
    const R = positive(section.d, 'd') / 2;
    const rc = positive(section.rc, 'r_c');
    if (rc <= R) fail('curvedRadius');
    const A = Math.PI * R * R;
    return {
      A,
      rc,
      ri: rc - R,
      ro: rc + R,
      integral: 2 * Math.PI * (rc - Math.sqrt(rc * rc - R * R)),
      I: (A * R * R) / 4,
    };
  }
  if (section.strips.length === 0) fail('noParts');
  let [A, first, integral] = [0, 0, 0];
  let [ri, ro] = [Infinity, -Infinity];
  for (const s of section.strips) {
    positive(s.b, 'b');
    if (!(s.r1 > 0 && s.r2 > s.r1)) fail('curvedRadius');
    A += s.b * (s.r2 - s.r1);
    first += (s.b * (s.r2 * s.r2 - s.r1 * s.r1)) / 2;
    integral += s.b * Math.log(s.r2 / s.r1);
    ri = Math.min(ri, s.r1);
    ro = Math.max(ro, s.r2);
  }
  const rc = first / A;
  // The second moment about the centroid, for the straight-beam comparison.
  const I = section.strips.reduce((sum, s) => sum + (s.b * ((s.r2 - rc) ** 3 - (s.r1 - rc) ** 3)) / 3, 0);
  return { A, rc, ri, ro, integral, I };
}

/**
 * Winkler's curved beam under a moment M about the centroid, and an optional normal force N through it. A positive
 * M straightens the beam, so it pulls on the inner fiber.
 */
export function curvedBeam(section: CurvedSection, M: number, N = 0): CurvedResult {
  finite(M, 'M');
  finite(N, 'N');
  const { A, rc, ri, ro, integral, I } = sectionSums(section);
  const rn = A / integral;
  const e = rc - rn;
  const stress = (r: number) => N / A + (M * (rn - r)) / (A * e * r);
  const straight = (r: number) => N / A + (M * (rc - r)) / I;
  const steps = [
    step('vessels.curvedSums', 'A = [[A]], \\quad r_c = [[rc]], \\quad \\int \\frac{dA}{r} = [[int]]', {
      A: q(A, 'area'),
      rc: q(rc, 'length'),
      int: q(integral, 'length'),
    }),
    step('vessels.neutral', 'r_n = \\frac{A}{\\int dA/r} = [[rn]], \\quad e = r_c - r_n = [[e]]', {
      rn: q(rn, 'length'),
      e: q(e, 'length'),
    }),
    step('vessels.winkler', '\\sigma = \\frac{N}{A} + \\frac{M (r_n - r)}{A e r}'),
    step('vessels.fibers', '\\sigma_i = \\sigma(r_i) = [[si]], \\quad \\sigma_o = \\sigma(r_o) = [[so]]', {
      si: q(stress(ri), 'stress'),
      so: q(stress(ro), 'stress'),
    }),
    step('vessels.straight', '\\sigma_{straight} = \\frac{N}{A} + \\frac{M (r_c - r)}{I}: \\ [[si]],\\ [[so]]', {
      si: q(straight(ri), 'stress'),
      so: q(straight(ro), 'stress'),
    }),
  ];
  return {
    A,
    rc,
    rn,
    e,
    ri,
    ro,
    inner: stress(ri),
    outer: stress(ro),
    straightInner: straight(ri),
    straightOuter: straight(ro),
    stress,
    straight,
    steps,
  };
}
