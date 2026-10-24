// Equations of motion for a planar rigid body: sum F = m a_G and sum M_G = I_G alpha, with the body free, pinned at
// a point, rolling without slip on level ground, or held by two smooth contacts (a ladder against a wall). Each
// support adds a reaction along a known direction at a known point and one equation on the accelerations, so the
// unknowns a_Gx, a_Gy, alpha, and the reactions come from one linear system. Positions are measured from the center
// of mass G, x to the right and y up, gravity acts down, angles in rad, counterclockwise positive.
import { solve } from '../num';
import { tex } from '../tex';
import { fail, finite, type MechStep, type Outcome } from '../types';

export type Support = 'free' | 'pinned' | 'rolling' | 'sliding';

export interface PlanarLoad {
  /** Size of the force, N, and its direction from +x, rad. */
  force: number;
  angle: number;
  /** Where it acts, from G, m. */
  at: [number, number];
}

/** A smooth contact: the body point, from G, and the direction the surface pushes it, rad from +x. */
export interface Contact {
  at: [number, number];
  normal: number;
}

export interface ForcesInput {
  mass: number;
  /** Moment of inertia about G, kg m^2. */
  IG: number;
  g: number;
  support: Support;
  /** Pinned: the pin, from G. */
  pin: [number, number];
  /** Rolling: the radius; the contact is r below G. */
  radius: number;
  /** Sliding: the two smooth contacts. */
  contacts: [Contact, Contact];
  loads: PlanarLoad[];
  /** A couple, N m. */
  couple: number;
  /** Angular velocity at this instant, rad/s (centripetal terms for a pinned or sliding body). */
  omega: number;
}

export interface Reaction {
  /** Point it acts at, from G, and its direction, as a unit vector. */
  at: [number, number];
  dir: [number, number];
  value: number;
}

export interface ForcesResult {
  aG: [number, number];
  alpha: number;
  reactions: Reaction[];
  /** Rolling: friction over normal force needed to roll; null otherwise. */
  muNeeded: number | null;
  /** A contact that would have to pull (a negative normal force): the body leaves it. */
  losesContact: boolean;
  steps: MechStep[];
}

export const FORCES_DEFAULTS: ForcesInput = {
  mass: 1,
  IG: 1 / 12,
  g: 9.81,
  support: 'pinned',
  pin: [-0.5, 0],
  radius: 0.1,
  contacts: [
    { at: [0.25, -0.433], normal: Math.PI / 2 },
    { at: [-0.25, 0.433], normal: 0 },
  ],
  loads: [],
  couple: 0,
  omega: 0,
};

/** One support row: the reaction's point and direction, and its equation coef . [a_Gx, a_Gy, alpha] = rhs. */
interface Row {
  at: [number, number];
  dir: [number, number];
  coef: [number, number, number];
  rhs: number;
}

const cross = (r: readonly number[], v: readonly number[]) => r[0] * v[1] - r[1] * v[0];
const unit = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];

/** A point that stays on a fixed line (or a fixed point, two of them) has no acceleration along n: n . (a_G +
 * alpha k x r - omega^2 r) = 0. */
function fixedAlong(at: [number, number], dir: [number, number], omega: number): Row {
  return { at, dir, coef: [dir[0], dir[1], cross(at, dir)], rhs: omega * omega * (dir[0] * at[0] + dir[1] * at[1]) };
}

function supportRows(input: ForcesInput): Row[] {
  const { support, pin, radius, contacts, omega } = input;
  if (support === 'pinned') return [fixedAlong(pin, [1, 0], omega), fixedAlong(pin, [0, 1], omega)];
  if (support === 'sliding') return contacts.map((c) => fixedAlong(c.at, unit(c.normal), omega));
  if (support === 'rolling') {
    // G stays at height r, and rolling ties a_G to alpha: a_Gx = -alpha r. Normal force and friction at the contact.
    const C: [number, number] = [0, -radius];
    return [
      { at: C, dir: [0, 1], coef: [0, 1, 0], rhs: 0 },
      { at: C, dir: [1, 0], coef: [1, 0, radius], rhs: 0 },
    ];
  }
  return [];
}

function invalid(input: ForcesInput) {
  const { mass, IG, g, pin, radius, contacts, loads, couple, omega } = input;
  const numbers = [mass, IG, g, ...pin, radius, couple, omega, ...contacts.flatMap((c) => [...c.at, c.normal])];
  if (!finite(...numbers, ...loads.flatMap((l) => [l.force, l.angle, ...l.at]))) return fail('notNumber');
  if (mass <= 0) return fail('positiveMass');
  if (IG <= 0) return fail('positiveInertia');
  if (g < 0) return fail('positiveGravity');
  if (input.support === 'rolling' && radius <= 0) return fail('positiveRadius');
  return null;
}

export function solveForces(input: ForcesInput): Outcome<ForcesResult> {
  const bad = invalid(input);
  if (bad) return bad;
  const { mass: m, IG, g, loads, couple } = input;
  const rows = supportRows(input);
  const k = rows.length;
  // Applied loads: the weight at G, the typed forces, and the couple.
  const forces = loads.map((l) => ({ at: l.at, F: unit(l.angle).map((u) => u * l.force) as [number, number] }));
  const Fx = forces.reduce((s, f) => s + f.F[0], 0);
  const Fy = forces.reduce((s, f) => s + f.F[1], 0) - m * g;
  const MG = forces.reduce((s, f) => s + cross(f.at, f.F), 0) + couple;
  // Unknowns [a_Gx, a_Gy, alpha, R_1..R_k].
  const A: number[][] = [
    [m, 0, 0, ...rows.map((r) => -r.dir[0])],
    [0, m, 0, ...rows.map((r) => -r.dir[1])],
    [0, 0, IG, ...rows.map((r) => -cross(r.at, r.dir))],
    ...rows.map((r) => [...r.coef, ...new Array<number>(k).fill(0)]),
  ];
  const x = solve(A, [Fx, Fy, MG, ...rows.map((r) => r.rhs)]);
  if (!x) return fail('forcesSingular');
  const [ax, ay, alpha] = x;
  const reactions = rows.map((r, i) => ({ at: r.at, dir: r.dir, value: x[3 + i] }));
  const normals = input.support === 'rolling' ? [reactions[0]] : input.support === 'sliding' ? reactions : [];
  const losesContact = normals.some((r) => r.value < -1e-12 * m * Math.max(g, 1));
  const muNeeded =
    input.support === 'rolling' && reactions[0].value > 0 ? Math.abs(reactions[1].value) / reactions[0].value : null;
  const steps: MechStep[] = [
    {
      key: 'kinForcesLoads',
      math:
        `\\textstyle\\sum F_x = ${tex(Fx)}\\ \\mathrm{N},\\ \\sum F_y = ${tex(Fy)}\\ \\mathrm{N},\\ ` +
        `\\sum M_G = ${tex(MG)}\\ \\mathrm{N\\,m}`,
    },
    {
      key: `kinForces_${input.support}`,
      math: SUPPORT_TEX[input.support],
    },
    {
      key: 'kinForcesSolve',
      math:
        `a_{Gx} = ${tex(ax)},\\ a_{Gy} = ${tex(ay)}\\ \\mathrm{m/s^2},\\ \\alpha = ${tex(alpha)}\\ \\mathrm{rad/s^2}` +
        (k ? `;\\ ${reactions.map((r, i) => `R_${i + 1} = ${tex(r.value)}`).join(',\\ ')}\\ \\mathrm{N}` : ''),
    },
  ];
  if (losesContact) steps.push({ key: 'kinForcesLeaves' });
  if (muNeeded !== null) steps.push({ key: 'kinForcesFriction', math: `\\mu \\ge |f|/N = ${tex(muNeeded)}` });
  return { ok: true, value: { aG: [ax, ay], alpha, reactions, muNeeded, losesContact, steps } };
}

const NEWTON = `m\\mathbf a_G = \\textstyle\\sum \\mathbf F + \\sum \\mathbf R,\\quad I_G\\alpha = \\sum M_G`;
/** The acceleration of a body point from G's: a_G + alpha k x r - omega^2 r. */
const POINT = (at: string) => `\\mathbf a_G + \\alpha\\mathbf k\\times\\mathbf r_${at} - \\omega^2\\mathbf r_${at}`;
const SUPPORT_TEX: Record<Support, string> = {
  free: NEWTON,
  pinned: `${NEWTON},\\quad \\mathbf a_P = ${POINT('P')} = \\mathbf 0`,
  rolling: `${NEWTON},\\quad a_{Gy} = 0,\\ a_{Gx} = -\\alpha r`,
  sliding: `${NEWTON},\\quad \\mathbf n_i\\cdot\\left(${POINT('i')}\\right) = 0`,
};
