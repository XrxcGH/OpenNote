// A DC circuit (item 10) on a grid: resistors, voltage and current sources, grounds, and wires as parts. A two-
// terminal part spans two grid steps from its first terminal (x, y) in the direction of its rotation; for a voltage
// source the second terminal is +, and a current source pushes current out of its second terminal. Values are in
// ohms, volts, and amperes. Terminals on the same grid point are joined, and so is any grid point along a wire.

export type CircuitKind = 'resistor' | 'voltage' | 'current' | 'ground' | 'wire';
export type Rotation = 0 | 90 | 180 | 270;

export interface CircuitPart {
  id: string;
  kind: CircuitKind;
  label: string;
  x: number;
  y: number;
  rotation: Rotation;
  /** Ω, V, or A. Unused for a ground or a wire. */
  value: number;
  /** A wire's other end. */
  x2?: number;
  y2?: number;
}

export interface CircuitModel {
  parts: CircuitPart[];
}

export interface Pt {
  x: number;
  y: number;
}

export const SPAN = 2;

const DIRECTIONS: Readonly<Record<Rotation, Pt>> = {
  0: { x: 1, y: 0 },
  90: { x: 0, y: 1 },
  180: { x: -1, y: 0 },
  270: { x: 0, y: -1 },
};

/** A part's terminals: one for a ground, two for everything else. */
export function terminals(part: CircuitPart): Pt[] {
  const a = { x: part.x, y: part.y };
  if (part.kind === 'ground') return [a];
  if (part.kind === 'wire') return [a, { x: part.x2 ?? part.x, y: part.y2 ?? part.y }];
  const d = DIRECTIONS[part.rotation];
  return [a, { x: part.x + d.x * SPAN, y: part.y + d.y * SPAN }];
}

export const turn = (rotation: Rotation, by: 90 | -90): Rotation => ((rotation + by + 360) % 360) as Rotation;

export const PREFIXES: Readonly<Record<CircuitKind, string>> = {
  resistor: 'R',
  voltage: 'V',
  current: 'I',
  ground: 'G',
  wire: 'W',
};

export const UNITS: Readonly<Record<CircuitKind, string>> = {
  resistor: 'Ω',
  voltage: 'V',
  current: 'A',
  ground: '',
  wire: '',
};

/** A new circuit: a 12 V source across a 4 kΩ and an 8 kΩ resistor in series, grounded on the bottom wire. */
export function starterCircuit(): CircuitModel {
  return {
    parts: [
      { id: 'v1', kind: 'voltage', label: 'V1', x: 2, y: 2, rotation: 90, value: 12 },
      { id: 'w1', kind: 'wire', label: 'W1', x: 2, y: 4, x2: 2, y2: 6, rotation: 0, value: 0 },
      { id: 'w2', kind: 'wire', label: 'W2', x: 2, y: 6, x2: 5, y2: 6, rotation: 0, value: 0 },
      { id: 'r1', kind: 'resistor', label: 'R1', x: 5, y: 6, rotation: 0, value: 4000 },
      { id: 'w3', kind: 'wire', label: 'W3', x: 7, y: 6, x2: 9, y2: 6, rotation: 0, value: 0 },
      { id: 'r2', kind: 'resistor', label: 'R2', x: 9, y: 6, rotation: 270, value: 8000 },
      { id: 'w4', kind: 'wire', label: 'W4', x: 9, y: 4, x2: 9, y2: 2, rotation: 0, value: 0 },
      { id: 'w5', kind: 'wire', label: 'W5', x: 9, y: 2, x2: 2, y2: 2, rotation: 0, value: 0 },
      { id: 'g1', kind: 'ground', label: 'G1', x: 5, y: 2, rotation: 0, value: 0 },
    ],
  };
}

const KINDS: readonly CircuitKind[] = ['resistor', 'voltage', 'current', 'ground', 'wire'];
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function readCircuit(raw: unknown): CircuitModel {
  if (typeof raw !== 'object' || raw === null) return starterCircuit();
  const list = (raw as Record<string, unknown>).parts;
  const parts: CircuitPart[] = [];
  for (const item of Array.isArray(list) ? list.slice(0, 300) : []) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (!KINDS.includes(p.kind as CircuitKind)) continue;
    const kind = p.kind as CircuitKind;
    const part: CircuitPart = {
      id: typeof p.id === 'string' ? p.id.slice(0, 40) : `p${parts.length + 1}`,
      kind,
      label: typeof p.label === 'string' ? p.label.slice(0, 20) : `${PREFIXES[kind]}${parts.length + 1}`,
      x: Math.round(num(p.x, 0)),
      y: Math.round(num(p.y, 0)),
      rotation: ROTATIONS.includes(p.rotation as Rotation) ? (p.rotation as Rotation) : 0,
      value: num(p.value, kind === 'resistor' ? 1000 : 1),
    };
    if (kind === 'wire') {
      part.x2 = Math.round(num(p.x2, part.x + 1));
      part.y2 = Math.round(num(p.y2, part.y));
    }
    parts.push(part);
  }
  return { parts };
}
