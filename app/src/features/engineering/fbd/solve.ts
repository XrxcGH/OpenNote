// The sums beside a free-body diagram: ΣFx, ΣFy, and ΣM about the chosen point from the known forces and moments,
// and, when the supports give exactly three independent unknowns, the reactions that hold the body in equilibrium.
// Moments are r × F with counterclockwise positive, as in statics texts.
import { clean, solveLinear } from '../linalg';
import type { FbdModel, SupportPart } from './model';

export interface Reaction {
  support: string;
  /** Such as "Ax", "Ay", "B", or "MA". */
  name: string;
  /** 'x' and 'y' are force components, 'n' a force along the roller's normal, and 'm' a moment. */
  component: 'x' | 'y' | 'n' | 'm';
  value: number;
  /** For 'n', the direction in degrees. */
  angle?: number;
}

export type FbdStatus = 'solved' | 'none' | 'indeterminate' | 'unstable';

export interface FbdResult {
  sumFx: number;
  sumFy: number;
  /** About the origin, counterclockwise positive. */
  sumM: number;
  /** The resultant of the known forces. */
  resultant: { magnitude: number; angle: number };
  status: FbdStatus;
  unknowns: number;
  reactions: Reaction[];
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;

interface Unknown {
  reaction: Omit<Reaction, 'value'>;
  /** Unit contributions to ΣFx, ΣFy, and ΣM about the origin. */
  column: [number, number, number];
}

function unknownsOf(support: SupportPart, origin: { x: number; y: number }): Unknown[] {
  const rx = support.x - origin.x;
  const ry = support.y - origin.y;
  const name = support.label || support.id;
  const force = (fx: number, fy: number): [number, number, number] => [fx, fy, rx * fy - ry * fx];
  switch (support.support) {
    case 'pin':
      return [
        { reaction: { support: support.id, name: `${name}x`, component: 'x' }, column: force(1, 0) },
        { reaction: { support: support.id, name: `${name}y`, component: 'y' }, column: force(0, 1) },
      ];
    case 'roller': {
      const a = rad(support.angle);
      return [
        {
          reaction: { support: support.id, name, component: 'n', angle: support.angle },
          column: force(Math.cos(a), Math.sin(a)),
        },
      ];
    }
    case 'fixed':
      return [
        { reaction: { support: support.id, name: `${name}x`, component: 'x' }, column: force(1, 0) },
        { reaction: { support: support.id, name: `${name}y`, component: 'y' }, column: force(0, 1) },
        { reaction: { support: support.id, name: `M${name}`, component: 'm' }, column: [0, 0, 1] },
      ];
  }
}

export function solveFbd(model: FbdModel): FbdResult {
  const { origin } = model;
  let fx = 0;
  let fy = 0;
  let m = 0;
  for (const part of model.parts) {
    if (part.kind === 'force') {
      const a = rad(part.angle);
      const px = part.magnitude * Math.cos(a);
      const py = part.magnitude * Math.sin(a);
      fx += px;
      fy += py;
      m += (part.x - origin.x) * py - (part.y - origin.y) * px;
    } else if (part.kind === 'moment') {
      m += part.magnitude;
    }
  }
  const unknowns = model.parts.flatMap((part) => (part.kind === 'support' ? unknownsOf(part, origin) : []));
  const base = {
    sumFx: clean(fx),
    sumFy: clean(fy),
    sumM: clean(m),
    resultant: { magnitude: clean(Math.hypot(fx, fy)), angle: clean(normalize((Math.atan2(fy, fx) * 180) / Math.PI)) },
    unknowns: unknowns.length,
  };
  if (unknowns.length === 0) return { ...base, status: 'none', reactions: [] };
  if (unknowns.length > 3) return { ...base, status: 'indeterminate', reactions: [] };
  if (unknowns.length < 3) return { ...base, status: 'unstable', reactions: [] };
  const matrix = [0, 1, 2].map((row) => unknowns.map((unknown) => unknown.column[row]));
  const solution = solveLinear(matrix, [-fx, -fy, -m]);
  if (!solution) return { ...base, status: 'unstable', reactions: [] };
  return {
    ...base,
    status: 'solved',
    reactions: unknowns.map((unknown, i) => ({ ...unknown.reaction, value: clean(solution[i]) })),
  };
}

/** An angle in [0, 360). */
export function normalize(degrees: number): number {
  const turned = degrees % 360;
  return turned < 0 ? turned + 360 : turned;
}
