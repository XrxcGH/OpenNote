// Rhythm arithmetic: Euclidean rhythms (Bjorklund), polyrhythm grids, note values in milliseconds, swing, and the
// rhythmic cycles of several traditions. The cycle data is written for the app from the standard teaching forms.

/** Bjorklund's algorithm: `onsets` hits spread as evenly as possible over `steps` steps, as 'x' and '.'. */
export function bjorklund(onsets: number, steps: number): string {
  if (onsets <= 0) return '.'.repeat(steps);
  if (onsets >= steps) return 'x'.repeat(steps);
  // One rest only: Toussaint's tables start "x." (E(3,4) = x.xx), the algorithm's raw output would end in the rest.
  if (steps - onsets === 1) return `x.${'x'.repeat(onsets - 1)}`;
  let a: string[][] = Array.from({ length: onsets }, () => ['x']);
  let b: string[][] = Array.from({ length: steps - onsets }, () => ['.']);
  while (b.length > 1) {
    const pairs = Math.min(a.length, b.length);
    const merged = Array.from({ length: pairs }, (_, i) => [...a[i]!, ...b[i]!]);
    const rest = a.length > b.length ? a.slice(pairs) : b.slice(pairs);
    a = merged;
    b = rest;
  }
  return [...a, ...b].flat().join('');
}

/** A pattern turned left by `by` steps, so a rotation starts later in the cycle. */
export function rotate(pattern: string, by: number): string {
  if (pattern.length === 0) return pattern;
  const k = ((by % pattern.length) + pattern.length) % pattern.length;
  return pattern.slice(k) + pattern.slice(0, k);
}

/** The gaps between neighboring onsets of a pattern, going round the cycle. */
export function gaps(pattern: string): number[] {
  const at = [...pattern].flatMap((c, i) => (c === 'x' ? [i] : []));
  return at.map((position, i) => (i < at.length - 1 ? at[i + 1]! - position : at[0]! + pattern.length - position));
}

export interface Polyrhythm {
  /** Steps in the shared grid: the least common multiple of the two counts. */
  length: number;
  first: string;
  second: string;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** An m against n grid: the first voice plays every length/m steps, the second every length/n. */
export function polyrhythm(m: number, n: number): Polyrhythm {
  const length = (m * n) / gcd(m, n);
  const voice = (count: number): string =>
    Array.from({ length }, (_, i) => (i % (length / count) === 0 ? 'x' : '.')).join('');
  return { length, first: voice(m), second: voice(n) };
}

export interface NoteValue {
  id: string;
  /** Length in quarter-note beats. */
  beats: number;
}

export const NOTE_VALUES: readonly NoteValue[] = [
  { id: 'whole', beats: 4 },
  { id: 'half', beats: 2 },
  { id: 'quarter', beats: 1 },
  { id: 'eighth', beats: 0.5 },
  { id: 'sixteenth', beats: 0.25 },
  { id: 'thirtySecond', beats: 0.125 },
];

/** Milliseconds in a note value at a tempo: 60000 / bpm × beats. Plain, dotted (×1.5), and triplet (×2/3). */
export const noteMs = (bpm: number, beats: number, kind: 'plain' | 'dotted' | 'triplet' = 'plain'): number =>
  (60000 / bpm) * beats * (kind === 'dotted' ? 1.5 : kind === 'triplet' ? 2 / 3 : 1);

/** The period of a delay time in hertz. */
export const msToHz = (ms: number): number => 1000 / ms;

/** Durations of a swung pair of eighth notes in milliseconds, for a long-to-short ratio such as 2 (2:1). */
export function swungPair(bpm: number, ratio: number): [number, number] {
  const beat = 60000 / bpm;
  return [(beat * ratio) / (ratio + 1), beat / (ratio + 1)];
}

/** Reads a swing setting written 2:1, 2, or 66% (the share of the beat the first note takes) as a long-to-short ratio. */
export function parseSwing(text: string): number | null {
  const t = text.trim();
  const pct = /^(\d*\.?\d+)\s*%$/.exec(t);
  if (pct) {
    const share = Number(pct[1]) / 100;
    return share > 0.5 && share < 1 ? share / (1 - share) : null;
  }
  const pair = /^(\d*\.?\d+)\s*:\s*(\d*\.?\d+)$/.exec(t);
  if (pair) return Number(pair[2]) > 0 && Number(pair[1]) >= Number(pair[2]) ? Number(pair[1]) / Number(pair[2]) : null;
  return /^\d*\.?\d+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}

export type Mark = 'sam' | 'tali' | 'khali' | 'clap' | 'finger' | 'wave';

export interface Cycle {
  id: string;
  family: 'hindustani' | 'carnatic';
  beats: number;
  /** The lengths of the sections (vibhag, or the parts of the tala). */
  sections: number[];
  /** Marked beats, counted from 1. */
  marks: Record<number, Mark>;
}

export const CYCLES: readonly Cycle[] = [
  {
    id: 'teentaal',
    family: 'hindustani',
    beats: 16,
    sections: [4, 4, 4, 4],
    marks: { 1: 'sam', 5: 'tali', 9: 'khali', 13: 'tali' },
  },
  {
    id: 'jhaptaal',
    family: 'hindustani',
    beats: 10,
    sections: [2, 3, 2, 3],
    marks: { 1: 'sam', 3: 'tali', 6: 'khali', 8: 'tali' },
  },
  { id: 'rupak', family: 'hindustani', beats: 7, sections: [3, 2, 2], marks: { 1: 'khali', 4: 'tali', 6: 'tali' } },
  {
    id: 'ektaal',
    family: 'hindustani',
    beats: 12,
    sections: [2, 2, 2, 2, 2, 2],
    marks: { 1: 'sam', 3: 'khali', 5: 'tali', 7: 'khali', 9: 'tali', 11: 'tali' },
  },
  { id: 'dadra', family: 'hindustani', beats: 6, sections: [3, 3], marks: { 1: 'sam', 4: 'khali' } },
  { id: 'keherwa', family: 'hindustani', beats: 8, sections: [4, 4], marks: { 1: 'sam', 5: 'khali' } },
  {
    id: 'deepchandi',
    family: 'hindustani',
    beats: 14,
    sections: [3, 4, 3, 4],
    marks: { 1: 'sam', 4: 'tali', 8: 'khali', 11: 'tali' },
  },
  {
    id: 'adi',
    family: 'carnatic',
    beats: 8,
    sections: [4, 2, 2],
    marks: { 1: 'clap', 2: 'finger', 3: 'finger', 4: 'finger', 5: 'clap', 6: 'wave', 7: 'clap', 8: 'wave' },
  },
];

/** The beats of a cycle where each section starts, counted from 1. */
export const sectionStarts = (cycle: Cycle): number[] =>
  cycle.sections.map((_, i) => 1 + cycle.sections.slice(0, i).reduce((sum, n) => sum + n, 0));

/** A cycle drawn as rows: beat numbers and their marks, with a bar between sections. */
export function cycleDiagram(cycle: Cycle): string {
  const starts = new Set(sectionStarts(cycle));
  const symbol: Record<Mark, string> = { sam: 'X', tali: 'T', khali: 'O', clap: 'C', finger: 'f', wave: 'W' };
  const numbers: string[] = [];
  const marks: string[] = [];
  for (let beat = 1; beat <= cycle.beats; beat++) {
    const bar = starts.has(beat) && beat > 1 ? '| ' : '';
    numbers.push(`${bar}${String(beat).padStart(2)}`);
    marks.push(`${bar.replace(/\|/g, ' ')}${(cycle.marks[beat] ? symbol[cycle.marks[beat]!] : '.').padStart(2)}`);
  }
  return `${numbers.join(' ')}\n${marks.join(' ')}`;
}

export interface StepPattern {
  id: string;
  /** 'x' is a hit; for the Arabic cycles 'D' is the deep stroke and 'T' the sharp one; '.' is silence. */
  steps: string;
  family: 'clave' | 'arabic';
}

export const PATTERNS: readonly StepPattern[] = [
  { id: 'son', steps: 'x..x..x...x.x...', family: 'clave' },
  { id: 'rumba', steps: 'x..x...x..x.x...', family: 'clave' },
  { id: 'bossa', steps: 'x..x..x...x..x..', family: 'clave' },
  { id: 'shiko', steps: 'x...x.x...x.x...', family: 'clave' },
  { id: 'gahu', steps: 'x..x..x...x...x.', family: 'clave' },
  { id: 'souku', steps: 'x..x..x...xx....', family: 'clave' },
  { id: 'bembe', steps: 'x.x.xx.x.x.x', family: 'clave' },
  { id: 'tresillo', steps: 'x..x..x.', family: 'clave' },
  { id: 'cinquillo', steps: 'x.xx.xx.', family: 'clave' },
  { id: 'habanera', steps: 'x..xx.x.', family: 'clave' },
  { id: 'maqsum', steps: 'DT.TD.T.', family: 'arabic' },
  { id: 'baladi', steps: 'DDT.D.T.', family: 'arabic' },
  { id: 'saidi', steps: 'DT.DD.T.', family: 'arabic' },
  { id: 'malfuf', steps: 'D..T..T.', family: 'arabic' },
];
