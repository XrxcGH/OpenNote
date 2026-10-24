// Reads a short SPICE-style netlist into elements and nodes. Text only ever becomes data here: nothing is evaluated.
// One element per line; '*' or '#' start a comment; the first letter of the name says what the element is.
import { fail, readNumber, toRadians } from '../shared';

export type Shape =
  | { kind: 'dc'; value: number }
  | { kind: 'step'; v0: number; v1: number; t0: number }
  | { kind: 'pulse'; v1: number; v2: number; td: number; tr: number; tf: number; pw: number; per: number }
  | { kind: 'sin'; off: number; amp: number; freq: number; td: number; phase: number };

export interface SourceSpec {
  shape: Shape;
  /** The small-signal part used by the AC sweep: magnitude and phase in radians. */
  acMag: number;
  acPhase: number;
}

export type Kind = 'R' | 'C' | 'L' | 'V' | 'I' | 'E' | 'G' | 'H' | 'F' | 'O' | 'S';

export interface Element {
  kind: Kind;
  name: string;
  line: number;
  /** Node indices, -1 for ground. R, C, L, V, I: [+, -]. E, G: [+, -, c+, c-]. O: [out, in+, in-]. */
  nodes: number[];
  /** Resistance, capacitance, inductance, gain, or transconductance. */
  value: number;
  ic?: number;
  source?: SourceSpec;
  /** The name of the voltage source whose current controls an H or F element. */
  control?: string;
  /** A switch closes at tClose and opens at tOpen. */
  tClose?: number;
  tOpen?: number;
}

export interface Circuit {
  elements: Element[];
  /** Node names other than ground, in order of first appearance. */
  nodes: string[];
}

const GROUND = new Set(['0', 'gnd']);
const NODE_COUNT: Record<Kind, number> = { R: 2, C: 2, L: 2, V: 2, I: 2, E: 4, G: 4, H: 2, F: 2, O: 3, S: 2 };
const MAX_ELEMENTS = 200;

/**
 * A value as students write it: 4.7k, 2.2K, 10uF, 1kΩ, 1kohm, 5V, 1meg. A trailing unit word is dropped (ohm, Ω, Hz and
 * a capital F, H, V, or A, so a lowercase f stays femto); K is kilo, and M stays mega as the hint says.
 */
export function readValue(text: string): number | null {
  const bare = text
    .trim()
    .replace(/(ohms?|Ω|hz)$/i, '')
    .replace(/(?<=[0-9.a-zµ])[FHVA]$/, '')
    .replace(/(?<=[0-9.])K$/, 'k');
  return readNumber(bare);
}

function num(text: string | undefined, line: number): number {
  const value = text === undefined ? null : readValue(text);
  if (value === null || !Number.isFinite(value)) return fail('netNumber', { line: String(line), text: text ?? '' });
  return value;
}

/** Reads the numbers after a source keyword, at least `min` and at most `max` of them. */
function takeNumbers(tokens: string[], at: number, min: number, max: number, line: number) {
  const out: number[] = [];
  let i = at;
  while (i < tokens.length && out.length < max && readValue(tokens[i]!) !== null) out.push(num(tokens[i++], line));
  if (out.length < min) fail('netSourceCount', { line: String(line), word: tokens[at - 1] ?? '' });
  return { values: out, next: i };
}

/** Reads `DC 5`, a bare number, `AC 1 0`, `STEP 0 5 1m`, `PULSE ...`, or `SIN ...`, alone or together. */
function parseSource(tokens: string[], line: number): SourceSpec {
  let shape: Shape = { kind: 'dc', value: 0 };
  let acMag = 0;
  let acPhase = 0;
  let i = 0;
  while (i < tokens.length) {
    const raw = tokens[i]!;
    const word = raw.toLowerCase();
    i++;
    if (readValue(raw) !== null) {
      shape = { kind: 'dc', value: num(raw, line) };
      continue;
    }
    const spec = SHAPES[word];
    if (!spec) return fail('netSourceWord', { line: String(line), word });
    const taken = takeNumbers(tokens, i, spec.min, spec.max, line);
    i = taken.next;
    const v = taken.values;
    if (word === 'ac') {
      acMag = v[0]!;
      acPhase = toRadians(v[1] ?? 0);
    } else shape = spec.make(v);
  }
  return { shape, acMag, acPhase };
}

interface ShapeSpec {
  min: number;
  max: number;
  make(v: number[]): Shape;
}

const SHAPES: Record<string, ShapeSpec> = {
  dc: { min: 1, max: 1, make: (v) => ({ kind: 'dc', value: v[0]! }) },
  ac: { min: 1, max: 2, make: () => ({ kind: 'dc', value: 0 }) },
  step: { min: 2, max: 3, make: (v) => ({ kind: 'step', v0: v[0]!, v1: v[1]!, t0: v[2] ?? 0 }) },
  pulse: {
    min: 6,
    max: 7,
    make: (v) => ({ kind: 'pulse', v1: v[0]!, v2: v[1]!, td: v[2]!, tr: v[3]!, tf: v[4]!, pw: v[5]!, per: v[6] ?? 0 }),
  },
  sin: {
    min: 3,
    max: 5,
    make: (v) => ({ kind: 'sin', off: v[0]!, amp: v[1]!, freq: v[2]!, td: v[3] ?? 0, phase: toRadians(v[4] ?? 0) }),
  },
};

const KIND_OF: Record<string, Kind> = {
  r: 'R',
  c: 'C',
  l: 'L',
  v: 'V',
  i: 'I',
  e: 'E',
  g: 'G',
  h: 'H',
  f: 'F',
  o: 'O',
  s: 'S',
};

function parseLine(raw: string, line: number, nodeOf: (name: string) => number): Element | null {
  const text = raw
    .replace(/[*#].*$/, '')
    .replace(/[(),]/g, ' ')
    .trim();
  if (text === '' || text.toLowerCase() === '.end') return null;
  const tokens = text.split(/\s+/);
  const name = tokens[0]!;
  const kind = KIND_OF[name[0]!.toLowerCase()];
  if (!kind) return fail('netWord', { line: String(line), word: name });
  const count = NODE_COUNT[kind];
  if (tokens.length < count + (kind === 'O' ? 1 : 2)) return fail('netCount', { line: String(line), name });
  const nodes = tokens.slice(1, 1 + count).map(nodeOf);
  const rest = tokens.slice(1 + count);
  const element: Element = { kind, name, line, nodes, value: 0 };
  const icAt = rest.findIndex((w) => /^ic=/i.test(w));
  if (icAt >= 0) {
    element.ic = num(rest[icAt]!.slice(3), line);
    rest.splice(icAt, 1);
  }
  fillValue(element, rest, line);
  return element;
}

/** Sets the element's value (or source, control, and switch times) from the words after its nodes. */
function fillValue(element: Element, rest: string[], line: number): void {
  const { kind } = element;
  if (kind === 'V' || kind === 'I') {
    element.source = parseSource(rest, line);
  } else if (kind === 'H' || kind === 'F') {
    if (rest.length < 2) fail('netCount', { line: String(line), name: element.name });
    element.control = rest[0]!;
    element.value = num(rest[1], line);
  } else if (kind === 'S') {
    element.tClose = num(rest[0], line);
    if (rest[1] !== undefined) element.tOpen = num(rest[1], line);
  } else if (kind === 'O') {
    element.value = 0;
  } else {
    element.value = num(rest[0], line);
    if ((kind === 'R' || kind === 'C' || kind === 'L') && !(element.value > 0)) {
      fail('netValue', { line: String(line), name: element.name });
    }
  }
}

export function parseNetlist(text: string): Circuit {
  const names: string[] = [];
  const index = new Map<string, number>();
  const nodeOf = (raw: string): number => {
    const key = raw.toLowerCase();
    if (GROUND.has(key)) return -1;
    const known = index.get(key);
    if (known !== undefined) return known;
    index.set(key, names.length);
    names.push(raw);
    return names.length - 1;
  };
  const elements: Element[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const element = parseLine(raw, i + 1, nodeOf);
    if (!element) return;
    const key = element.name.toLowerCase();
    if (seen.has(key)) fail('netDuplicate', { line: String(i + 1), name: element.name });
    seen.add(key);
    elements.push(element);
  });
  if (elements.length === 0) fail('netEmpty');
  if (elements.length > MAX_ELEMENTS) fail('netTooMany', { max: String(MAX_ELEMENTS) });
  checkConnections(elements, names.length);
  return { elements, nodes: names };
}

/** Controls must name a voltage source, and the circuit must touch ground somewhere. */
function checkConnections(elements: Element[], nodeCount: number): void {
  const volts = new Set(elements.filter((e) => e.kind === 'V').map((e) => e.name.toLowerCase()));
  for (const e of elements) {
    if (e.control !== undefined && !volts.has(e.control.toLowerCase())) {
      fail('netControl', { line: String(e.line), name: e.control });
    }
  }
  if (nodeCount > 0 && !elements.some((e) => e.nodes.includes(-1))) fail('netNoGround');
}

/** The index of a node by name, or -1 for ground; null when there is no such node. */
export function nodeIndex(circuit: Circuit, name: string): number | null {
  const key = name.trim().toLowerCase();
  if (GROUND.has(key)) return -1;
  const at = circuit.nodes.findIndex((n) => n.toLowerCase() === key);
  return at < 0 ? null : at;
}
