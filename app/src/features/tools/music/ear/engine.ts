// Ear-training drills: seeded items for intervals, chord qualities, scales, melodies, rhythms, and
// sight-singing, with answer reading and grading. The same seed and settings always give the same items.
import { Rng } from '../../subjects/num/rng';
import type { PlayNote, PlayPlan } from '../audio';
import { QUALITIES, quality, spellChord } from '../theory/chords';
import {
  degreeNote,
  hzOf,
  intervalShort,
  intervalWords,
  midiOf,
  noteName,
  parseInterval,
  parseNote,
  parsePitchClass,
  pitchClassName,
  transposeNote,
} from '../theory/notes';
import type { Interval, Note } from '../theory/notes';
import { scaleDef, spellScale } from '../theory/scales';
import { scaleLabel } from '../theory/practice';

export type DrillKind = 'interval' | 'chord' | 'scale' | 'melody' | 'rhythm' | 'sing';
export type Level = 'easy' | 'medium' | 'hard';
export type Range = 'low' | 'mid' | 'high';
export type Delivery = 'up' | 'down' | 'together';

export interface Settings {
  level: Level;
  range: Range;
  delivery: Delivery;
  /** Notes in a melody, or steps in a rhythm are set by the level; this is the melody length. */
  length: number;
  bpm: number;
}

export type Item =
  | { kind: 'interval'; n: number; root: Note; interval: Interval; delivery: Delivery; plan: PlayPlan }
  | { kind: 'chord'; n: number; root: Note; qualityId: string; plan: PlayPlan }
  | { kind: 'scale'; n: number; tonic: Note; scaleId: string; plan: PlayPlan }
  | { kind: 'melody'; n: number; tonic: Note; notes: Note[]; degrees: number[]; plan: PlayPlan }
  | { kind: 'rhythm'; n: number; steps: string; plan: PlayPlan }
  | { kind: 'sing'; n: number; tonic: Note; minor: boolean; notes: Note[]; degrees: number[]; plan: PlayPlan };

const RANGES: Record<Range, [number, number]> = { low: [48, 59], mid: [55, 67], high: [60, 72] };

const INTERVALS: Record<Level, string[]> = {
  easy: ['m3', 'M3', 'P4', 'P5', 'P8'],
  medium: ['m2', 'M2', 'm3', 'M3', 'P4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
  hard: ['P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'],
};
const CHORDS: Record<Level, string[]> = {
  easy: ['major', 'minor'],
  medium: ['major', 'minor', 'diminished', 'augmented'],
  hard: [
    'major',
    'minor',
    'diminished',
    'augmented',
    'dominant7',
    'major7',
    'minor7',
    'halfDiminished7',
    'diminished7',
  ],
};
const SCALES: Record<Level, string[]> = {
  easy: ['ionian', 'aeolian'],
  medium: ['ionian', 'aeolian', 'dorian', 'mixolydian', 'lydian', 'phrygian'],
  hard: [
    'ionian',
    'aeolian',
    'dorian',
    'mixolydian',
    'lydian',
    'phrygian',
    'locrian',
    'harmonicMinor',
    'melodicMinor',
    'wholeTone',
  ],
};
const KEYS = [
  { step: 0, alt: 0 },
  { step: 4, alt: 0 },
  { step: 3, alt: 0 },
  { step: 1, alt: 0 },
  { step: 6, alt: -1 },
];

const tone = (hz: number, at: number, dur: number): PlayNote => ({ at, dur, hz, level: 1, voice: 'tone' });

/** A root note in the range: a letter and a sharp or flat, chosen so the pitch sits inside the range. */
function pickRoot(rng: Rng, range: Range, level: Level): Note {
  const [low, high] = RANGES[range];
  for (let tries = 0; tries < 50; tries++) {
    const step = rng.integer(7);
    const alt = level === 'easy' ? 0 : [-1, 0, 0, 1][rng.integer(4)]!;
    const octave = 2 + rng.integer(4);
    const note = { step, alt, octave };
    const midi = midiOf(note);
    if (midi >= low && midi <= high) return note;
  }
  return { step: 0, alt: 0, octave: 4 };
}

const sequence = (notes: readonly Note[], bpm: number): PlayPlan => ({
  notes: notes.map((n, i) => tone(hzOf(n), i, 1)),
  beats: notes.length,
  bpm,
  loop: false,
});

/** Major-key degree zero-based 0..14 above the tonic, as a note. */
function scaleNote(tonic: Note, degree: number, minor: boolean): Note {
  const tokens = minor ? ['1', '2', 'b3', '4', '5', 'b6', 'b7'] : ['1', '2', '3', '4', '5', '6', '7'];
  const octave = Math.floor(degree / 7);
  const base = degreeNote(tonic, tokens[((degree % 7) + 7) % 7]!);
  return { ...base, octave: base.octave + octave };
}

function makeItem(rng: Rng, kind: DrillKind, s: Settings, n: number): Item {
  switch (kind) {
    case 'interval': {
      for (;;) {
        const root = pickRoot(rng, s.range, s.level);
        const name = INTERVALS[s.level][rng.integer(INTERVALS[s.level].length)]!;
        const interval = parseInterval(name)!;
        const delivery = s.delivery;
        const up = interval.generic === 1 ? root : transposeNote(root, interval);
        const down = transposeNote(root, interval, true);
        const top = delivery === 'down' ? down : up;
        if (Math.abs(top.alt) > 2) continue;
        const first = root;
        const second = top;
        const plan: PlayPlan =
          delivery === 'together'
            ? { notes: [tone(hzOf(first), 0, 2), tone(hzOf(second), 0, 2)], beats: 2, bpm: s.bpm, loop: false }
            : sequence([first, second], s.bpm);
        return { kind, n, root, interval, delivery, plan };
      }
    }
    case 'chord': {
      const ids = CHORDS[s.level];
      const qualityId = ids[rng.integer(ids.length)]!;
      for (;;) {
        const root = pickRoot(rng, s.range, s.level);
        const notes = spellChord(root, quality(qualityId));
        if (notes.some((x) => Math.abs(x.alt) > 2)) continue;
        const plan: PlayPlan =
          s.delivery === 'together'
            ? { notes: notes.map((x) => tone(hzOf(x), 0, 2)), beats: 2, bpm: s.bpm, loop: false }
            : sequence(notes, s.bpm);
        return { kind, n, root, qualityId, plan };
      }
    }
    case 'scale': {
      const ids = SCALES[s.level];
      const scaleId = ids[rng.integer(ids.length)]!;
      const tonic = pickRoot(rng, 'mid', 'easy');
      const notes = spellScale(tonic, scaleDef(scaleId).degrees);
      return { kind, n, tonic, scaleId, plan: sequence(notes, s.bpm) };
    }
    case 'melody':
    case 'sing': {
      const key = KEYS[rng.integer(KEYS.length)]!;
      const minor = kind === 'sing' && rng.integer(2) === 1;
      const tonic: Note = { ...key, octave: 4 };
      const moves =
        s.level === 'easy'
          ? [-2, -1, 1, 2]
          : s.level === 'medium'
            ? [-3, -2, -1, 1, 2, 3]
            : [-4, -3, -2, -1, 1, 2, 3, 4];
      const degrees = [0];
      while (degrees.length < s.length) {
        const prev = degrees[degrees.length - 1]!;
        const move = moves[rng.integer(moves.length)]!;
        const next = prev + move;
        if (next < -2 || next > 7) continue;
        degrees.push(next);
      }
      const notes = degrees.map((d) => scaleNote(tonic, d, minor));
      const reference = tone(hzOf(tonic), 0, 1);
      const plan: PlayPlan =
        kind === 'sing'
          ? { notes: [reference], beats: 1, bpm: s.bpm, loop: false }
          : {
              notes: [reference, ...notes.map((x, i) => tone(hzOf(x), i + 2, 1))],
              beats: notes.length + 2,
              bpm: s.bpm,
              loop: false,
            };
      return kind === 'melody'
        ? { kind, n, tonic, notes, degrees, plan }
        : { kind, n, tonic, minor, notes, degrees, plan };
    }
    case 'rhythm': {
      const length = s.level === 'easy' ? 4 : s.level === 'medium' ? 8 : 12;
      for (;;) {
        let steps = 'x';
        while (steps.length < length) steps += rng.integer(100) < 55 ? 'x' : '.';
        if ([...steps].filter((c) => c === 'x').length < 3) continue;
        const plan: PlayPlan = {
          notes: [...steps].flatMap((c, i) =>
            c === 'x'
              ? [{ at: i / 2, dur: 0.4, hz: 1000, level: (i === 0 ? 2 : 1) as 1 | 2, voice: 'click' as const }]
              : [],
          ),
          beats: length / 2,
          bpm: s.bpm,
          loop: false,
        };
        return { kind, n, steps, plan };
      }
    }
  }
}

/** The nth item (counted from 1) of a drill: the items before it are drawn first so the sequence never depends on n. */
export function itemAt(kind: DrillKind, seed: bigint, settings: Settings, n: number): Item {
  const rng = new Rng(seed);
  let item: Item | undefined;
  for (let i = 1; i <= n; i++) item = makeItem(rng, kind, settings, i);
  return item!;
}

// --- reading answers -------------------------------------------------------------------------------------------------

const QUALITY_WORDS: Record<string, string> = {
  perfect: 'P',
  major: 'M',
  minor: 'm',
  augmented: 'A',
  diminished: 'd',
  aug: 'A',
  dim: 'd',
  maj: 'M',
  min: 'm',
  perf: 'P',
};
const ORDINALS: Record<string, string> = {
  unison: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  sixth: '6',
  seventh: '7',
  octave: '8',
  '1st': '1',
  '2nd': '2',
  '3rd': '3',
  '4th': '4',
  '5th': '5',
  '6th': '6',
  '7th': '7',
  '8th': '8',
};

/** Reads "major sixth", "M6", "perfect 5th", or "tritone" as a count of semitones; null when it is not an interval. */
export function readIntervalAnswer(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === 'tritone') return 6;
  const direct = parseInterval(text.trim().replace(/\s+/g, ''));
  if (direct) return direct.semitones;
  const m = /^(\w+)\s*-?\s*(\w+)$/.exec(t);
  if (!m) return null;
  const q = QUALITY_WORDS[m[1]!];
  const size = ORDINALS[m[2]!] ?? (/^\d{1,2}$/.test(m[2]!) ? m[2]! : undefined);
  if (!q || !size) return null;
  return parseInterval(`${q}${size}`)?.semitones ?? null;
}

const CHORD_WORDS: Record<string, string> = {
  major: 'major',
  maj: 'major',
  minor: 'minor',
  min: 'minor',
  diminished: 'diminished',
  dim: 'diminished',
  augmented: 'augmented',
  aug: 'augmented',
  'dominant seventh': 'dominant7',
  'dominant 7th': 'dominant7',
  'dominant 7': 'dominant7',
  'major seventh': 'major7',
  'major 7th': 'major7',
  'minor seventh': 'minor7',
  'minor 7th': 'minor7',
  'half-diminished': 'halfDiminished7',
  'half diminished': 'halfDiminished7',
  'half-diminished seventh': 'halfDiminished7',
  'diminished seventh': 'diminished7',
  'diminished 7th': 'diminished7',
};

/** Reads a chord quality typed in words or as a symbol suffix (m7, dim7, ø7); null when it is not one. */
export function readChordAnswer(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (CHORD_WORDS[t]) return CHORD_WORDS[t]!;
  const raw = text.trim();
  const symbol = QUALITIES.find((q) => q.symbols.includes(raw));
  return symbol && raw !== '' ? symbol.id : raw === '' ? null : null;
}

const SCALE_WORDS: Record<string, string> = {
  major: 'ionian',
  ionian: 'ionian',
  minor: 'aeolian',
  'natural minor': 'aeolian',
  aeolian: 'aeolian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  'harmonic minor': 'harmonicMinor',
  'melodic minor': 'melodicMinor',
  'whole tone': 'wholeTone',
  'whole-tone': 'wholeTone',
};

export const readScaleAnswer = (text: string): string | null =>
  SCALE_WORDS[text.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;

/** A melody answer such as "C D F" or "C4 D4 F4": pitch classes, with an octave only when typed. */
export function readNoteList(text: string): { step: number; alt: number; octave?: number }[] | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const out: { step: number; alt: number; octave?: number }[] = [];
  for (const token of tokens) {
    const withOctave = parseNote(token);
    if (withOctave) out.push(withOctave);
    else {
      const pc = parsePitchClass(token);
      if (!pc) return null;
      out.push(pc);
    }
  }
  return out;
}

export const noteMatches = (typed: { step: number; alt: number; octave?: number }, target: Note): boolean =>
  typed.step === target.step &&
  typed.alt === target.alt &&
  (typed.octave === undefined || typed.octave === target.octave);

// --- solfege ------------------------------------------------------------------------------------------------------------------

const DO_MAJOR = ['do', 're', 'mi', 'fa', 'sol', 'la', 'ti'] as const;
const LA_MINOR = ['la', 'ti', 'do', 're', 'mi', 'fa', 'sol'] as const;
const DO_MINOR = ['do', 're', 'me', 'fa', 'sol', 'le', 'te'] as const;

/** The syllable for a zero-based scale degree (which may be negative or above the octave). */
export function syllable(degree: number, minor: boolean, base: 'la' | 'do'): string {
  const table = !minor ? DO_MAJOR : base === 'la' ? LA_MINOR : DO_MINOR;
  return table[((degree % 7) + 7) % 7]!;
}

// --- describing an item --------------------------------------------------------------------------------------------

export const intervalName = (i: Interval): string => `${intervalWords(i)} (${intervalShort(i)})`;
export const chordMembers = (root: Note, id: string): string =>
  spellChord(root, quality(id))
    .map((n) => pitchClassName(n))
    .join(' ');
export const scaleName = (id: string): string => scaleLabel(id);
export const spelled = (notes: readonly Note[]): string => notes.map((n) => noteName(n)).join(' ');
