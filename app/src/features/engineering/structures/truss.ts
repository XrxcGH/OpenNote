// The truss solver (item 7): member forces (tension positive) and support reactions for a plane pin-jointed truss.
// It uses the direct stiffness method with the same AE for every member, and supports as constraints (a pin holds
// both directions, a roller holds the direction it pushes in), solved with Lagrange multipliers. For a statically
// determinate truss this gives exactly the method-of-joints answer, whatever AE is.
import { clean, solveLinear, zeros } from '../linalg';

export type TrussSupport = 'pin' | 'roller';

export interface Joint {
  id: string;
  label: string;
  x: number;
  y: number;
  support?: TrussSupport;
  /** For a roller, the direction its reaction pushes, in degrees: 90 is up. */
  angle?: number;
  /** The load on the joint. */
  fx?: number;
  fy?: number;
}

export interface Member {
  id: string;
  a: string;
  b: string;
}

export interface TrussModel {
  joints: Joint[];
  members: Member[];
  forceUnit: string;
  lengthUnit: string;
}

export type TrussStatus = 'determinate' | 'indeterminate' | 'unstable' | 'none';

export interface TrussReaction {
  joint: string;
  /** 'x' and 'y' for a pin, 'n' for a roller (along its angle). */
  component: 'x' | 'y' | 'n';
  value: number;
  angle?: number;
}

export interface TrussResult {
  status: TrussStatus;
  /** Member ID to axial force; tension is positive. */
  forces: Map<string, number>;
  reactions: TrussReaction[];
  counts: { members: number; reactions: number; joints: number };
}

export function solveTruss(model: TrussModel): TrussResult {
  const index = new Map(model.joints.map((joint, i) => [joint.id, i]));
  const members = model.members.filter(
    (m) => index.has(m.a) && index.has(m.b) && m.a !== m.b && length(model, m) > 1e-9,
  );
  const constraints: { joint: number; component: TrussReaction['component']; dir: [number, number]; angle?: number }[] =
    [];
  model.joints.forEach((joint, i) => {
    if (joint.support === 'pin') {
      constraints.push({ joint: i, component: 'x', dir: [1, 0] }, { joint: i, component: 'y', dir: [0, 1] });
    } else if (joint.support === 'roller') {
      const angle = joint.angle ?? 90;
      const a = (angle * Math.PI) / 180;
      constraints.push({ joint: i, component: 'n', dir: [Math.cos(a), Math.sin(a)], angle });
    }
  });
  const counts = { members: members.length, reactions: constraints.length, joints: model.joints.length };
  const none: TrussResult = { status: 'none', forces: new Map(), reactions: [], counts };
  if (constraints.length === 0 || model.joints.length === 0) return none;

  const dofs = model.joints.length * 2;
  const size = dofs + constraints.length;
  const A = zeros(size, size);
  const b = new Array<number>(size).fill(0);
  for (const member of members) {
    const [i, j] = [index.get(member.a)!, index.get(member.b)!];
    const [c, s, l] = direction(model, member);
    const k = [
      [c * c, c * s],
      [c * s, s * s],
    ].map((row) => row.map((v) => v / l));
    for (let p = 0; p < 2; p++) {
      for (let q = 0; q < 2; q++) {
        A[2 * i + p][2 * i + q] += k[p][q];
        A[2 * j + p][2 * j + q] += k[p][q];
        A[2 * i + p][2 * j + q] -= k[p][q];
        A[2 * j + p][2 * i + q] -= k[p][q];
      }
    }
  }
  model.joints.forEach((joint, i) => {
    b[2 * i] = joint.fx ?? 0;
    b[2 * i + 1] = joint.fy ?? 0;
  });
  constraints.forEach((constraint, n) => {
    const row = dofs + n;
    for (let p = 0; p < 2; p++) {
      A[row][2 * constraint.joint + p] = constraint.dir[p];
      A[2 * constraint.joint + p][row] = constraint.dir[p];
    }
  });
  const solution = solveLinear(A, b);
  if (!solution || counts.members + counts.reactions < 2 * counts.joints) {
    return { ...none, status: 'unstable' };
  }
  const forces = new Map<string, number>();
  for (const member of members) {
    const [i, j] = [index.get(member.a)!, index.get(member.b)!];
    const [c, s, l] = direction(model, member);
    const stretch = (solution[2 * j] - solution[2 * i]) * c + (solution[2 * j + 1] - solution[2 * i + 1]) * s;
    forces.set(member.id, clean(stretch / l));
  }
  // K u + Cᵀλ = F, so the support pushes on the joint with −λ along each constraint direction.
  const reactions = constraints.map((constraint, n): TrussReaction => ({
    joint: model.joints[constraint.joint].id,
    component: constraint.component,
    value: clean(-solution[dofs + n]),
    ...(constraint.angle !== undefined ? { angle: constraint.angle } : {}),
  }));
  const status = counts.members + counts.reactions > 2 * counts.joints ? 'indeterminate' : 'determinate';
  return { status, forces, reactions, counts };
}

function length(model: TrussModel, member: Member): number {
  return direction(model, member)[2];
}

/** The member's direction cosines from a to b, and its length. */
function direction(model: TrussModel, member: Member): [number, number, number] {
  const a = model.joints.find((joint) => joint.id === member.a)!;
  const b = model.joints.find((joint) => joint.id === member.b)!;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l === 0 ? [1, 0, 0] : [(b.x - a.x) / l, (b.y - a.y) / l, l];
}

/** A new truss: a 6 m Warren truss with a load in the middle. */
export function starterTruss(): TrussModel {
  return {
    joints: [
      { id: 'j1', label: 'A', x: 2, y: 2, support: 'pin' },
      { id: 'j2', label: 'B', x: 5, y: 2, fy: -10 },
      { id: 'j3', label: 'C', x: 8, y: 2, support: 'roller', angle: 90 },
      { id: 'j4', label: 'D', x: 3.5, y: 4.5 },
      { id: 'j5', label: 'E', x: 6.5, y: 4.5 },
    ],
    members: [
      { id: 'm1', a: 'j1', b: 'j2' },
      { id: 'm2', a: 'j2', b: 'j3' },
      { id: 'm3', a: 'j1', b: 'j4' },
      { id: 'm4', a: 'j4', b: 'j2' },
      { id: 'm5', a: 'j2', b: 'j5' },
      { id: 'm6', a: 'j5', b: 'j3' },
      { id: 'm7', a: 'j4', b: 'j5' },
    ],
    forceUnit: 'kN',
    lengthUnit: 'm',
  };
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value.slice(0, 40) : fallback);

export function readTruss(raw: unknown): TrussModel {
  if (typeof raw !== 'object' || raw === null) return starterTruss();
  const data = raw as Record<string, unknown>;
  const joints: Joint[] = [];
  for (const item of Array.isArray(data.joints) ? data.joints.slice(0, 200) : []) {
    const j = (item ?? {}) as Record<string, unknown>;
    const joint: Joint = {
      id: str(j.id, `j${joints.length + 1}`),
      label: str(j.label, ''),
      x: num(j.x, 0),
      y: num(j.y, 0),
    };
    if (j.support === 'pin' || j.support === 'roller') joint.support = j.support;
    if (typeof j.angle === 'number' && Number.isFinite(j.angle)) joint.angle = j.angle;
    if (typeof j.fx === 'number' && Number.isFinite(j.fx)) joint.fx = j.fx;
    if (typeof j.fy === 'number' && Number.isFinite(j.fy)) joint.fy = j.fy;
    joints.push(joint);
  }
  const ids = new Set(joints.map((joint) => joint.id));
  const members: Member[] = [];
  for (const item of Array.isArray(data.members) ? data.members.slice(0, 400) : []) {
    const m = (item ?? {}) as Record<string, unknown>;
    const [a, b] = [str(m.a, ''), str(m.b, '')];
    if (ids.has(a) && ids.has(b) && a !== b) members.push({ id: str(m.id, `m${members.length + 1}`), a, b });
  }
  return { joints, members, forceUnit: str(data.forceUnit, 'kN'), lengthUnit: str(data.lengthUnit, 'm') };
}
