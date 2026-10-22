// A free-body diagram (item 6): a body, the forces and moments on it, and the supports that hold it. Positions are in
// grid units with y up, as on paper, so a force at angle 90 points up the page. Each support adds unknown reactions:
// a pin two (Rx and Ry), a roller one along its surface normal, and a fixed support three (Rx, Ry, and a moment).

export type SupportKind = 'pin' | 'roller' | 'fixed';

export interface BodyPart {
  id: string;
  kind: 'body';
  /** The center. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ForcePart {
  id: string;
  kind: 'force';
  /** The point the force acts at: the arrow's tail. */
  x: number;
  y: number;
  /** Degrees counterclockwise from the +x axis. */
  angle: number;
  magnitude: number;
  label: string;
}

export interface MomentPart {
  id: string;
  kind: 'moment';
  x: number;
  y: number;
  /** Counterclockwise is positive. */
  magnitude: number;
  label: string;
}

export interface SupportPart {
  id: string;
  kind: 'support';
  support: SupportKind;
  x: number;
  y: number;
  /** For a roller, the direction its reaction pushes, in degrees: 90 for a roller under a beam. */
  angle: number;
  label: string;
}

export type FbdPart = BodyPart | ForcePart | MomentPart | SupportPart;

export interface FbdModel {
  parts: FbdPart[];
  /** The point moments are summed about. */
  origin: { x: number; y: number };
  forceUnit: string;
  lengthUnit: string;
}

export const FBD_COLUMNS = 16;
export const FBD_ROWS = 9;

/** A new diagram: a beam-like body on a pin and a roller, with one downward force. */
export function starterFbd(): FbdModel {
  return {
    parts: [
      { id: 'b1', kind: 'body', x: 8, y: 4, w: 8, h: 1 },
      { id: 's1', kind: 'support', support: 'pin', x: 4, y: 3.5, angle: 90, label: 'A' },
      { id: 's2', kind: 'support', support: 'roller', x: 12, y: 3.5, angle: 90, label: 'B' },
      { id: 'f1', kind: 'force', x: 7, y: 4.5, angle: 270, magnitude: 10, label: 'F1' },
    ],
    origin: { x: 4, y: 3.5 },
    forceUnit: 'kN',
    lengthUnit: 'm',
  };
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value.slice(0, 40) : fallback);

/** Reads a stored diagram, dropping parts it does not understand. */
export function readFbd(raw: unknown): FbdModel {
  const start = starterFbd();
  if (typeof raw !== 'object' || raw === null) return start;
  const data = raw as Record<string, unknown>;
  const parts: FbdPart[] = [];
  for (const item of Array.isArray(data.parts) ? data.parts.slice(0, 200) : []) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const id = str(p.id, `p${parts.length + 1}`);
    const x = num(p.x, 0);
    const y = num(p.y, 0);
    if (p.kind === 'body')
      parts.push({ id, kind: 'body', x, y, w: Math.max(0.5, num(p.w, 4)), h: Math.max(0.5, num(p.h, 1)) });
    else if (p.kind === 'force')
      parts.push({
        id,
        kind: 'force',
        x,
        y,
        angle: num(p.angle, 270),
        magnitude: num(p.magnitude, 1),
        label: str(p.label, 'F'),
      });
    else if (p.kind === 'moment')
      parts.push({ id, kind: 'moment', x, y, magnitude: num(p.magnitude, 1), label: str(p.label, 'M') });
    else if (p.kind === 'support' && (p.support === 'pin' || p.support === 'roller' || p.support === 'fixed'))
      parts.push({ id, kind: 'support', support: p.support, x, y, angle: num(p.angle, 90), label: str(p.label, 'S') });
  }
  const origin =
    typeof data.origin === 'object' && data.origin !== null ? (data.origin as Record<string, unknown>) : {};
  return {
    parts,
    origin: { x: num(origin.x, start.origin.x), y: num(origin.y, start.origin.y) },
    forceUnit: str(data.forceUnit, 'kN'),
    lengthUnit: str(data.lengthUnit, 'm'),
  };
}

/** A label not yet used by a part of this kind: F1, F2, and so on. */
export function nextLabel(parts: readonly FbdPart[], prefix: string): string {
  const used = new Set(parts.map((part) => ('label' in part ? part.label : '')));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function nextId(parts: readonly { id: string }[]): string {
  const used = new Set(parts.map((part) => part.id));
  let n = parts.length + 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}
