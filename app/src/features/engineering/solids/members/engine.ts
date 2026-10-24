// Members under axial load, torsion, bending, and transverse shear, and their sum at a point of the section. The
// member runs along x. In the section, y is up and z is toward you, so x, y, and z are right-handed. Tension is
// positive. A positive Mz compresses the fibers at positive y, and a positive My stretches the fibers at positive z,
// so σ = N/A − Mz·y/Iz + My·z/Iy when Iyz is zero (Hibbeler). Torque T turns about +x by the right-hand rule.
// Everything is in base SI.
import { fail, finite, positive, q, step, type KitStep } from '../kit/types';

const has = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const or0 = (value: number | undefined) => (has(value) ? value : 0);

export interface AxialInput {
  readonly ends: 'free' | 'fixed';
  readonly P: number;
  readonly A: number;
  readonly L: number;
  readonly E: number;
  /** Where the load acts on a bar fixed at both ends, from the left end. */
  readonly a?: number;
  readonly alpha?: number;
  readonly dT?: number;
}

export interface AxialResult {
  /** Stress, force, and strain left of the load; on a free bar, along the whole bar. */
  readonly N1: number;
  readonly sigma1: number;
  /** Right of the load, on a bar fixed at both ends. */
  readonly N2?: number;
  readonly sigma2?: number;
  /** Change of length of a free bar, or the movement of the load point of a fixed one. */
  readonly delta: number;
  readonly strain: number;
  readonly steps: KitStep[];
}

/** A bar fixed at its left end. A free right end carries P; a fixed right end makes the bar indeterminate. */
export function axialMember(input: AxialInput): AxialResult {
  const P = finite(input.P, 'P');
  const A = positive(input.A, 'A');
  const L = positive(input.L, 'L');
  const E = positive(input.E, 'E');
  const thermal = or0(input.alpha) * or0(input.dT);
  const EA = E * A;
  if (input.ends === 'free') {
    const delta = (P * L) / EA + thermal * L;
    const steps = [
      step('members.axial', '\\sigma = \\frac{P}{A} = \\frac{[[P]]}{[[A]]} = [[s]]', {
        P: q(P, 'force'),
        A: q(A, 'area'),
        s: q(P / A, 'stress'),
      }),
      step('members.deform', '\\delta = \\frac{PL}{AE} + \\alpha\\,\\Delta T\\,L = [[dP]] + [[dT]] = [[d]]', {
        dP: q((P * L) / EA, 'deflection'),
        dT: q(thermal * L, 'deflection'),
        d: q(delta, 'deflection'),
      }),
    ];
    return { N1: P, sigma1: P / A, delta, strain: delta / L, steps };
  }
  const a = finite(input.a ?? NaN, 'a');
  if (a < 0 || a > L) fail('loadOffBar');
  // Compatibility: the two parts' changes of length add to zero, and the joint at a carries P, so N1 − N2 = P.
  const N1 = (P * (L - a)) / L - EA * thermal;
  const N2 = N1 - P;
  const delta = (N1 * a) / EA + thermal * a;
  const steps = [
    step(
      'members.compatible',
      '\\frac{N_1 a}{AE} + \\frac{N_2 (L - a)}{AE} + \\alpha\\,\\Delta T\\,L = 0, \\quad N_1 - N_2 = P',
    ),
    step(
      'members.indeterminate',
      'N_1 = \\frac{P(L - a)}{L} - EA\\alpha\\Delta T = [[N1]], \\quad N_2 = N_1 - P = [[N2]]',
      { N1: q(N1, 'force'), N2: q(N2, 'force') },
    ),
    step('members.parts', '\\sigma_1 = \\frac{N_1}{A} = [[s1]], \\quad \\sigma_2 = \\frac{N_2}{A} = [[s2]]', {
      s1: q(N1 / A, 'stress'),
      s2: q(N2 / A, 'stress'),
    }),
    step('members.loadPoint', 'u_a = \\frac{N_1 a}{AE} + \\alpha\\,\\Delta T\\,a = [[u]]', {
      u: q(delta, 'deflection'),
    }),
  ];
  return { N1, sigma1: N1 / A, N2, sigma2: N2 / A, delta, strain: N1 / EA + thermal, steps };
}

export type TorsionSection = 'solid' | 'hollow' | 'thinClosed' | 'thinOpen';

export interface TorsionInput {
  readonly section: TorsionSection;
  /** The torque, or else the power and the speed in revolutions per second. */
  readonly T?: number;
  readonly power?: number;
  readonly speed?: number;
  readonly L: number;
  readonly G: number;
  readonly d?: number;
  readonly di?: number;
  /** The centerline width and height of a closed thin-walled box, and the wall thickness. */
  readonly bm?: number;
  readonly hm?: number;
  readonly t?: number;
  /** The centerline length of an open thin-walled section. */
  readonly s?: number;
}

export interface TorsionResult {
  readonly T: number;
  /** The torsion constant (J for a circle; 4Am²/∮ds/t for a closed tube; Σ b t³/3 for an open one). */
  readonly J: number;
  readonly tauMax: number;
  readonly tauMin?: number;
  readonly phi: number;
  readonly gammaMax: number;
  readonly Am?: number;
  readonly steps: KitStep[];
}

/** The torque, given directly or from power over angular speed. */
function torqueOf(input: TorsionInput, steps: KitStep[]): number {
  if (input.T !== undefined) return finite(input.T, 'T');
  const power = finite(input.power ?? NaN, 'P');
  const omega = 2 * Math.PI * positive(input.speed ?? NaN, 'n');
  const T = power / omega;
  steps.push(
    step('members.power', 'T = \\frac{P}{\\omega} = \\frac{P}{2\\pi n} = \\frac{[[P]]}{[[w]]} = [[T]]', {
      P: q(power, 'power'),
      w: q(omega, 'angularSpeed'),
      T: q(T, 'smallMoment'),
    }),
  );
  return T;
}

interface Twisted {
  readonly J: number;
  readonly tauMax: number;
  readonly tauMin?: number;
  readonly Am?: number;
}

function roundShaft(input: TorsionInput, T: number, steps: KitStep[]): Twisted {
  const d = positive(input.d ?? NaN, 'd');
  const di = input.section === 'hollow' ? positive(input.di ?? NaN, 'd_i') : 0;
  if (di >= d) fail('innerTooBig');
  const J = (Math.PI * (d ** 4 - di ** 4)) / 32;
  const tauMax = (T * d) / 2 / J;
  steps.push(
    step('members.polar', 'J = \\frac{\\pi (d^4 - d_i^4)}{32} = [[J]]', { J: q(J, 'inertia') }),
    step('members.torsionStress', '\\tau_{max} = \\frac{T c}{J} = \\frac{[[T]] \\times [[c]]}{[[J]]} = [[tau]]', {
      T: q(T, 'smallMoment'),
      c: q(d / 2, 'length'),
      J: q(J, 'inertia'),
      tau: q(tauMax, 'stress'),
    }),
  );
  if (di === 0) return { J, tauMax };
  const tauMin = (T * di) / 2 / J;
  steps.push(step('members.inner', '\\tau_{i} = \\frac{T d_i/2}{J} = [[tau]]', { tau: q(tauMin, 'stress') }));
  return { J, tauMax, tauMin };
}

/** Bredt's formulas for a closed thin-walled box of centerline bm by hm. */
function closedBox(input: TorsionInput, T: number, steps: KitStep[]): Twisted {
  const bm = positive(input.bm ?? NaN, 'b_m');
  const hm = positive(input.hm ?? NaN, 'h_m');
  const t = positive(input.t ?? NaN, 't');
  if (t >= Math.min(bm, hm)) fail('tooThick');
  const Am = bm * hm;
  const around = (2 * (bm + hm)) / t;
  const J = (4 * Am ** 2) / around;
  const tauMax = T / (2 * Am * t);
  steps.push(
    step('members.enclosed', 'A_m = b_m h_m = [[Am]], \\quad \\oint \\frac{ds}{t} = \\frac{2(b_m + h_m)}{t} = [[s]]', {
      Am: q(Am, 'area'),
      s: around,
    }),
    step('members.bredt', '\\tau = \\frac{T}{2 A_m t} = \\frac{[[T]]}{2 \\times [[Am]] \\times [[t]]} = [[tau]]', {
      T: q(T, 'smallMoment'),
      Am: q(Am, 'area'),
      t: q(t, 'length'),
      tau: q(tauMax, 'stress'),
    }),
    step('members.closedJ', 'J = \\frac{4 A_m^2}{\\oint ds/t} = [[J]]', { J: q(J, 'inertia') }),
  );
  return { J, tauMax, Am };
}

function openStrip(input: TorsionInput, T: number, steps: KitStep[]): Twisted {
  const s = positive(input.s ?? NaN, 's');
  const t = positive(input.t ?? NaN, 't');
  if (t >= s) fail('tooThick');
  const J = (s * t ** 3) / 3;
  const tauMax = (T * t) / J;
  steps.push(
    step('members.open', 'J = \\frac{s\\,t^3}{3} = [[J]], \\quad \\tau_{max} = \\frac{T t}{J} = [[tau]]', {
      J: q(J, 'inertia'),
      tau: q(tauMax, 'stress'),
    }),
  );
  return { J, tauMax };
}

export function torsionMember(input: TorsionInput): TorsionResult {
  const L = positive(input.L, 'L');
  const G = positive(input.G, 'G');
  const steps: KitStep[] = [];
  const T = torqueOf(input, steps);
  const shape = { solid: roundShaft, hollow: roundShaft, thinClosed: closedBox, thinOpen: openStrip }[input.section];
  const twisted = shape(input, T, steps);
  const phi = (T * L) / (G * twisted.J);
  steps.push(
    step('members.twist', '\\phi = \\frac{T L}{G J} = \\frac{[[T]] \\times [[L]]}{[[G]] \\times [[J]]} = [[phi]]', {
      T: q(T, 'smallMoment'),
      L: q(L, 'span'),
      G: q(G, 'modulus'),
      J: q(twisted.J, 'inertia'),
      phi: q(phi, 'radians'),
    }),
  );
  return { T, ...twisted, phi, gammaMax: twisted.tauMax / G, steps };
}

export interface BendingInput {
  readonly My: number;
  readonly Mz: number;
  readonly Iy: number;
  readonly Iz: number;
  readonly Iyz?: number;
  readonly y: number;
  readonly z: number;
  readonly N?: number;
  readonly A?: number;
  readonly V?: number;
  readonly Q?: number;
  readonly t?: number;
}

export interface BendingResult {
  readonly sigmaN: number;
  readonly sigmaY: number;
  readonly sigmaZ: number;
  readonly sigma: number;
  /** The angle of the neutral axis from the z axis, counterclockwise toward y. */
  readonly alpha: number;
  readonly tau?: number;
  readonly steps: KitStep[];
}

/** The general flexure formula for unsymmetric bending, with an axial part and VQ/(It), at the point (y, z). */
export function bendingPoint(input: BendingInput): BendingResult {
  const Iy = positive(input.Iy, 'I_y');
  const Iz = positive(input.Iz, 'I_z');
  const Iyz = has(input.Iyz) ? input.Iyz : 0;
  const D = Iy * Iz - Iyz ** 2;
  if (!(D > 1e-12 * Iy * Iz)) fail('inertiaMatrix');
  const My = finite(input.My, 'M_y');
  const Mz = finite(input.Mz, 'M_z');
  const y = finite(input.y, 'y');
  const z = finite(input.z, 'z');
  const steps: KitStep[] = [];
  let sigmaN = 0;
  if (has(input.N) && input.N !== 0) {
    const A = positive(input.A ?? NaN, 'A');
    sigmaN = input.N / A;
    steps.push(step('members.axialPart', '\\sigma_N = \\frac{N}{A} = [[s]]', { s: q(sigmaN, 'stress') }));
  }
  const b = -(Mz * Iy + My * Iyz) / D;
  const c = (My * Iz + Mz * Iyz) / D;
  const sigmaY = b * y;
  const sigmaZ = c * z;
  const sigma = sigmaN + sigmaY + sigmaZ;
  steps.push(
    step(
      'members.flexure',
      '\\sigma = -\\frac{M_z I_y + M_y I_{yz}}{I_y I_z - I_{yz}^2}\\,y + \\frac{M_y I_z + M_z I_{yz}}{I_y I_z - I_{yz}^2}\\,z',
    ),
    step('members.bendingTerms', '\\sigma_{y} = [[sy]], \\quad \\sigma_{z} = [[sz]]', {
      sy: q(sigmaY, 'stress'),
      sz: q(sigmaZ, 'stress'),
    }),
    step('members.normalSum', '\\sigma = \\sigma_N + \\sigma_y + \\sigma_z = [[s]]', { s: q(sigma, 'stress') }),
  );
  // σ is zero where b·y + c·z = 0, so the neutral axis has tan α = y/z = −c/b.
  let alpha = b === 0 && c === 0 ? 0 : Math.atan2(-c, b);
  if (alpha > Math.PI / 2) alpha -= Math.PI;
  if (alpha <= -Math.PI / 2) alpha += Math.PI;
  if (b !== 0 || c !== 0) {
    steps.push(
      step('members.neutral', '\\tan\\alpha = \\frac{y}{z} = -\\frac{c}{b}, \\quad \\alpha = [[a]]', {
        a: q(alpha, 'angle'),
      }),
    );
  }
  let tau: number | undefined;
  if (has(input.V)) {
    const Q = finite(input.Q ?? NaN, 'Q');
    const t = positive(input.t ?? NaN, 't');
    tau = (input.V * Q) / (Iz * t);
    steps.push(
      step('members.shear', '\\tau = \\frac{V Q}{I t} = \\frac{[[V]] \\times [[Q]]}{[[I]] \\times [[t]]} = [[tau]]', {
        V: q(input.V, 'force'),
        Q: q(Q, 'volume'),
        I: q(Iz, 'inertia'),
        t: q(t, 'length'),
        tau: q(tau, 'stress'),
      }),
    );
  }
  return { sigmaN, sigmaY, sigmaZ, sigma, alpha, ...(tau === undefined ? {} : { tau }), steps };
}

export type CombinedShape = 'rect' | 'circle' | 'tube';

export interface CombinedInput {
  readonly shape: CombinedShape;
  /** A rectangle is b wide (along z) and h deep (along y). */
  readonly b?: number;
  readonly h?: number;
  readonly d?: number;
  readonly di?: number;
  readonly N?: number;
  readonly Vy?: number;
  readonly Vz?: number;
  readonly T?: number;
  readonly My?: number;
  readonly Mz?: number;
  readonly y: number;
  readonly z: number;
}

export interface CombinedResult {
  readonly A: number;
  readonly Iy: number;
  readonly Iz: number;
  readonly J?: number;
  readonly sigma: number;
  readonly tauXy: number;
  readonly tauXz: number;
  /** Each part on its own: [name, σ, τxy, τxz]. */
  readonly parts: readonly (readonly [string, number, number, number])[];
  readonly principal: readonly [number, number, number];
  readonly steps: KitStep[];
}

/** First moment and width of the part of a circle of radius R beyond the distance u from its center. */
function circleCut(R: number, u: number) {
  const s = Math.max(R * R - u * u, 0);
  return { Q: (2 / 3) * s ** 1.5, t: 2 * Math.sqrt(s) };
}

/** Every load at a point of a rectangle, a solid circle, or a round tube, then the element's principal stresses. */
export function combinedPoint(input: CombinedInput): CombinedResult {
  const y = finite(input.y, 'y');
  const z = finite(input.z, 'z');
  const [N, Vy, Vz, T, My, Mz] = [input.N, input.Vy, input.Vz, input.T, input.My, input.Mz].map(or0);
  let A: number;
  let Iy: number;
  let Iz: number;
  let J: number | undefined;
  let shearY: number;
  let shearZ: number;
  if (input.shape === 'rect') {
    const b = positive(input.b ?? NaN, 'b');
    const h = positive(input.h ?? NaN, 'h');
    if (Math.abs(y) > (h / 2) * (1 + 1e-12) || Math.abs(z) > (b / 2) * (1 + 1e-12)) fail('outside');
    if (T !== 0) fail('rectTorsion');
    A = b * h;
    Iz = (b * h ** 3) / 12;
    Iy = (h * b ** 3) / 12;
    shearY = (Vy * (b / 2) * ((h * h) / 4 - y * y)) / (Iz * b);
    shearZ = (Vz * (h / 2) * ((b * b) / 4 - z * z)) / (Iy * h);
  } else {
    const d = positive(input.d ?? NaN, 'd');
    const di = input.shape === 'tube' ? positive(input.di ?? NaN, 'd_i') : 0;
    if (di >= d) fail('innerTooBig');
    const [R, Ri] = [d / 2, di / 2];
    const r = Math.hypot(y, z);
    if (r > R * (1 + 1e-12) || r < Ri * (1 - 1e-12)) fail('outside');
    A = (Math.PI * (d * d - di * di)) / 4;
    Iy = (Math.PI * (d ** 4 - di ** 4)) / 64;
    Iz = Iy;
    J = 2 * Iy;
    // V Q/(I t) across the chord through the point, the average over that chord, outer cut less the inner one.
    const across = (u: number) => {
      const outer = circleCut(R, u);
      const inner = Math.abs(u) < Ri ? circleCut(Ri, u) : { Q: 0, t: 0 };
      return { Q: outer.Q - inner.Q, t: outer.t - inner.t };
    };
    const cy = across(y);
    const cz = across(z);
    shearY = cy.t > 0 ? (Vy * cy.Q) / (Iz * cy.t) : 0;
    shearZ = cz.t > 0 ? (Vz * cz.Q) / (Iy * cz.t) : 0;
  }
  const sN = N / A;
  const sMz = (-Mz * y) / Iz;
  const sMy = (My * z) / Iy;
  const tT = J === undefined ? [0, 0] : [(-T * z) / J, (T * y) / J];
  const parts: [string, number, number, number][] = [
    ['N', sN, 0, 0],
    ['Mz', sMz, 0, 0],
    ['My', sMy, 0, 0],
    ['Vy', 0, shearY, 0],
    ['Vz', 0, 0, shearZ],
    ['T', 0, tT[0], tT[1]],
  ];
  const sigma = sN + sMz + sMy;
  const tauXy = shearY + tT[0];
  const tauXz = shearZ + tT[1];
  const half = sigma / 2;
  const R = Math.sqrt(half * half + tauXy * tauXy + tauXz * tauXz);
  const sorted = [half + R, 0, half - R].sort((m, n) => n - m) as [number, number, number];
  const steps: KitStep[] = [
    step(
      'members.sectionProps',
      'A = [[A]], \\quad I_y = [[Iy]], \\quad I_z = [[Iz]]' + (J ? ', \\quad J = [[J]]' : ''),
      {
        A: q(A, 'area'),
        Iy: q(Iy, 'inertia'),
        Iz: q(Iz, 'inertia'),
        ...(J ? { J: q(J, 'inertia') } : {}),
      },
    ),
    step(
      'members.normalParts',
      '\\sigma = \\frac{N}{A} - \\frac{M_z y}{I_z} + \\frac{M_y z}{I_y} = [[a]] + [[b]] + [[c]] = [[s]]',
      { a: q(sN, 'stress'), b: q(sMz, 'stress'), c: q(sMy, 'stress'), s: q(sigma, 'stress') },
    ),
    step('members.shearParts', '\\tau_{xy} = \\frac{V_y Q}{I_z t} - \\frac{T z}{J} = [[a]] + [[b]] = [[s]]', {
      a: q(shearY, 'stress'),
      b: q(tT[0], 'stress'),
      s: q(tauXy, 'stress'),
    }),
    step('members.shearPartsZ', '\\tau_{xz} = \\frac{V_z Q}{I_y t} + \\frac{T y}{J} = [[a]] + [[b]] = [[s]]', {
      a: q(shearZ, 'stress'),
      b: q(tT[1], 'stress'),
      s: q(tauXz, 'stress'),
    }),
    step(
      'members.principal',
      '\\sigma_{1,3} = \\frac{\\sigma}{2} \\pm \\sqrt{\\left(\\frac{\\sigma}{2}\\right)^2 + \\tau_{xy}^2 + \\tau_{xz}^2}' +
        ' = [[s1]],\\ [[s3]]',
      { s1: q(sorted[0], 'stress'), s3: q(sorted[2], 'stress') },
    ),
  ];
  return { A, Iy, Iz, ...(J ? { J } : {}), sigma, tauXy, tauXz, parts, principal: sorted, steps };
}
