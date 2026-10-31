// Moment distribution for plane frames, held against sway or free to sway in one story. End moments are clockwise
// positive on the member, in kN·m; loads act on the right of each member's a-to-b direction (down on a beam drawn
// left to right). Nothing here reads the DOM or the strings.
import { need } from '../core/types';

/** support: 0 free to rotate and sway, 1 fixed, 2 pinned. */
export interface FrameJoint {
  x: number;
  y: number;
  support: number;
}

/** a and b number joints from 1; w is a uniform load across the member, kN/m. */
export interface FrameMember {
  a: number;
  b: number;
  EI: number;
  w: number;
}

/** A horizontal load at a joint, kN, positive to the right. */
export interface FrameLoad {
  joint: number;
  H: number;
}

type Ends = [number, number][];

interface Geometry {
  L: number;
  ux: number;
  uy: number;
}

const free = (j: FrameJoint): boolean => j.support === 0;

function validate(joints: readonly FrameJoint[], members: readonly FrameMember[]): Geometry[] {
  need(joints.length >= 2 && members.length >= 1, 'structures.errors.frame');
  for (const j of joints) need([0, 1, 2].includes(j.support), 'structures.errors.frameSupport');
  return members.map((m) => {
    const ok = (k: number) => Number.isInteger(k) && k >= 1 && k <= joints.length;
    need(ok(m.a) && ok(m.b) && m.a !== m.b, 'structures.errors.memberJoints');
    need(m.EI > 0, 'errors.positive', { name: '~structures.f.EICol' });
    const A = joints[m.a - 1]!;
    const B = joints[m.b - 1]!;
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    need(L > 0, 'errors.positive', { name: '~structures.f.LCol' });
    return { L, ux: (B.x - A.x) / L, uy: (B.y - A.y) / L };
  });
}

/** Distribution factors at each member end: k = 4EI/L shared among the ends at a joint that can rotate. */
function distributionFactors(joints: readonly FrameJoint[], members: readonly FrameMember[], geo: Geometry[]): Ends {
  const sum = joints.map(() => 0);
  const k = members.map((m, i) => (4 * m.EI) / geo[i]!.L);
  members.forEach((m, i) => {
    sum[m.a - 1]! += k[i]!;
    sum[m.b - 1]! += k[i]!;
  });
  const df = (joint: number, ki: number) => (joints[joint - 1]!.support === 1 ? 0 : ki / sum[joint - 1]!);
  return members.map((m, i) => [df(m.a, k[i]!), df(m.b, k[i]!)]);
}

/** Balances every joint that can rotate and carries half of each correction to the far end, all at once per cycle. */
function distribute(members: readonly FrameMember[], df: Ends, fem: Ends, joints: number, tol: number) {
  const M = fem.map(([a, b]) => [a, b] as [number, number]);
  const scale = Math.max(1, ...fem.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b))));
  let cycles = 0;
  for (; cycles < 20000; cycles++) {
    const unbalanced = new Array<number>(joints).fill(0);
    members.forEach((m, i) => {
      unbalanced[m.a - 1]! += M[i]![0];
      unbalanced[m.b - 1]! += M[i]![1];
    });
    let biggest = 0;
    const carry: Ends = members.map(() => [0, 0]);
    members.forEach((m, i) => {
      const da = -unbalanced[m.a - 1]! * df[i]![0];
      const db = -unbalanced[m.b - 1]! * df[i]![1];
      biggest = Math.max(biggest, Math.abs(da), Math.abs(db));
      M[i]![0] += da;
      M[i]![1] += db;
      carry[i]![1] += da / 2;
      carry[i]![0] += db / 2;
    });
    carry.forEach(([a, b], i) => {
      M[i]![0] += a;
      M[i]![1] += b;
    });
    if (biggest < tol * scale) break;
  }
  need(cycles < 20000, 'errors.noConvergence');
  return { M, cycles: cycles + 1 };
}

/** The horizontal force a brace at beam level must supply to hold the free joints against sway. */
function restraint(
  joints: readonly FrameJoint[],
  members: readonly FrameMember[],
  geo: Geometry[],
  M: Ends,
  loads: readonly FrameLoad[],
  withLoads: boolean,
): number {
  let sum = 0;
  if (withLoads) for (const l of loads) if (free(joints[l.joint - 1]!)) sum += l.H;
  members.forEach((m, i) => {
    const { L, uy } = geo[i]!;
    const w = withLoads ? m.w : 0;
    const fa = free(joints[m.a - 1]!);
    const fb = free(joints[m.b - 1]!);
    // Shears on the member toward its left normal n = (−uy, ux); the member pushes its joint with −V n.
    const Vb = (w * L) / 2 + (M[i]![0] + M[i]![1]) / L;
    const Va = w * L - Vb;
    if (fa && fb) sum += w * L * uy;
    else if (fa) sum += Va * uy;
    else if (fb) sum += Vb * uy;
  });
  return -sum;
}

export interface FrameSolution {
  /** Final end moments [M_ab, M_ba] per member. */
  moments: Ends;
  df: Ends;
  fem: Ends;
  /** Moments with the joints held against sway, and the brace force that holds them, kN. */
  held: Ends;
  brace: number;
  cycles: number;
  /** Sway only: moments for the trial sway, its brace force, and the factor applied to them. */
  sway?: { fem: Ends; moments: Ends; brace: number; factor: number };
}

/**
 * Hardy Cross moment distribution for a plane frame. With sway, the frame must be one story: vertical columns from
 * the supports to the free joints and level beams between them. The sidesway correction distributes trial moments
 * of −100 kN·m in the stiffest column and scales them so the story shear balances the horizontal loads.
 */
export function frameMomentDistribution(
  joints: readonly FrameJoint[],
  members: readonly FrameMember[],
  loads: readonly FrameLoad[],
  sway: boolean,
  tol = 1e-11,
): FrameSolution {
  const geo = validate(joints, members);
  for (const l of loads) {
    need(Number.isInteger(l.joint) && l.joint >= 1 && l.joint <= joints.length, 'structures.errors.memberJoints');
  }
  const df = distributionFactors(joints, members, geo);
  const fem: Ends = members.map((m, i) => {
    const f = (m.w * geo[i]!.L ** 2) / 12;
    return [-f, f];
  });
  const held = distribute(members, df, fem, joints.length, tol);
  const brace = restraint(joints, members, geo, held.M, loads, true);
  if (!sway) return { moments: held.M, df, fem, held: held.M, brace, cycles: held.cycles };

  // Chord rotation for a unit sway of every free joint: ψ = (f_b − f_a) u_y / L, giving FEM = −6 EI ψ / L.
  const psi = members.map((m, i) => {
    const fa = free(joints[m.a - 1]!) ? 1 : 0;
    const fb = free(joints[m.b - 1]!) ? 1 : 0;
    const { ux, uy, L } = geo[i]!;
    if (fa !== fb) need(Math.abs(ux) < 1e-9, 'structures.errors.swayShape');
    if (fa && fb) need(Math.abs(uy) < 1e-9, 'structures.errors.swayShape');
    return ((fb - fa) * uy) / L;
  });
  const unit = members.map((m, i) => (-6 * m.EI * psi[i]!) / geo[i]!.L);
  const peak = Math.max(...unit.map(Math.abs));
  need(peak > 0, 'structures.errors.swayShape');
  const swayFem: Ends = unit.map((u) => [(100 * u) / peak, (100 * u) / peak]);
  const trial = distribute(members, df, swayFem, joints.length, tol);
  const trialBrace = restraint(joints, members, geo, trial.M, loads, false);
  need(Math.abs(trialBrace) > 1e-9, 'structures.errors.swayShape');
  const factor = -brace / trialBrace;
  const moments: Ends = held.M.map(([a, b], i) => [a + factor * trial.M[i]![0], b + factor * trial.M[i]![1]]);
  return {
    moments,
    df,
    fem,
    held: held.M,
    brace,
    cycles: held.cycles + trial.cycles,
    sway: { fem: swayFem, moments: trial.M, brace: trialBrace, factor },
  };
}
