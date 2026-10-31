// Four-part chorale checking against the common-practice rules taught in theory courses. Every issue names its chord,
// the voices, and the rule. Textbooks differ, so the rules come in three strictness levels.
import { analyze } from '../theory/keys';
import type { Mode, Pc } from '../theory/keys';
import { between, midiOf, noteName, parseNote, pitchClass, pitchClassName } from '../theory/notes';
import type { Note } from '../theory/notes';
import { nameChord } from '../theory/chords';

export type Strictness = 'relaxed' | 'standard' | 'strict';

/** Voices from the top down: soprano, alto, tenor, bass. */
export const VOICES = ['soprano', 'alto', 'tenor', 'bass'] as const;
export type Voice = (typeof VOICES)[number];

export type RuleId =
  | 'parallelFifths'
  | 'parallelOctaves'
  | 'parallelUnisons'
  | 'directFifths'
  | 'directOctaves'
  | 'crossing'
  | 'overlap'
  | 'spacing'
  | 'range'
  | 'doubledLeadingTone'
  | 'leadingTone'
  | 'seventh'
  | 'augmented'
  | 'largeLeap'
  | 'leapRecovery'
  | 'incomplete';

export const RULE_TEXT: Record<RuleId, string> = {
  parallelFifths: 'parallel fifths',
  parallelOctaves: 'parallel octaves',
  parallelUnisons: 'parallel unisons',
  directFifths: 'direct (hidden) fifths in the outer voices',
  directOctaves: 'direct (hidden) octaves in the outer voices',
  crossing: 'voice crossing',
  overlap: 'voice overlap',
  spacing: 'more than an octave between neighboring upper voices',
  range: 'outside the usual range of the voice',
  doubledLeadingTone: 'doubled leading tone',
  leadingTone: 'leading tone does not resolve up to the tonic',
  seventh: 'chordal seventh does not resolve down by step',
  augmented: 'augmented melodic interval',
  largeLeap: 'leap too large for the voice',
  leapRecovery: 'large leap is not followed by a step the other way',
  incomplete: 'incomplete chord: the third is missing',
};

export interface Issue {
  /** The 1-based chord (or the move into it) where the problem is. */
  chord: number;
  voices: Voice[];
  rule: RuleId;
}

/** Common textbook ranges from the lowest note to the highest, rounded for teaching. */
export const RANGES: Record<Voice, [string, string]> = {
  soprano: ['C4', 'G5'],
  alto: ['G3', 'D5'],
  tenor: ['C3', 'G4'],
  bass: ['E2', 'C4'],
};

const inRange = (voice: Voice, note: Note): boolean => {
  const [low, high] = RANGES[voice];
  return midiOf(note) >= midiOf(parseNote(low)!) && midiOf(note) <= midiOf(parseNote(high)!);
};

/** One chord: the four voices' notes, soprano first. */
export type Chord = [Note, Note, Note, Note];

const semis = (n: Note): number => midiOf(n);
const dir = (a: Note, b: Note): number => Math.sign(semis(b) - semis(a));

/** The perfect interval class between two notes: 'P5', 'P8' (octaves of any size), 'P1' for a unison, or null. */
function perfectKind(upper: Note, lower: Note): 'P1' | 'P5' | 'P8' | null {
  const s = semis(upper) - semis(lower);
  if (s < 0) return null;
  const { interval } = between(lower, upper);
  const simple = ((interval.generic - 1) % 7) + 1;
  if (s === 0) return 'P1';
  if (s % 12 === 0 && simple === 1) return 'P8';
  if (s % 12 === 7 && simple === 5) return 'P5';
  return null;
}

const PAIRS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

/** The chords of a text, one chord a line with the soprano first; a problem is the 1-based line and what is wrong. */
export function readChords(text: string): { chords: Chord[] } | { line: number; reason: 'count' | 'note' } {
  const chords: Chord[] = [];
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i]!.split(/[\s,|]+/).filter(Boolean);
    if (tokens.length !== 4) return { line: i + 1, reason: 'count' };
    const notes = tokens.map((t) => parseNote(t));
    if (notes.some((n) => n === null)) return { line: i + 1, reason: 'note' };
    chords.push(notes as Chord);
  }
  return { chords };
}

export interface Report {
  issues: Issue[];
  numerals: string[];
  cadence: 'authentic' | 'perfectAuthentic' | 'plagal' | 'deceptive' | 'half' | 'none';
}

interface Context {
  chords: readonly Chord[];
  tonic: Pc;
  leadingPc: number;
  standard: boolean;
  strict: boolean;
  add(chord: number, voices: Voice[], rule: RuleId): void;
}

const NAMES: Voice[] = [...VOICES];

/** Problems inside one chord: crossing, spacing, range, doubling, and a missing third. */
function checkWithin(c: Context, chord: Chord, n: number): void {
  for (let v = 0; v < 3; v++) {
    if (semis(chord[v]!) < semis(chord[v + 1]!)) c.add(n, [NAMES[v]!, NAMES[v + 1]!], 'crossing');
  }
  if (!c.standard) return;
  for (let v = 0; v < 2; v++) {
    if (semis(chord[v]!) - semis(chord[v + 1]!) > 12) c.add(n, [NAMES[v]!, NAMES[v + 1]!], 'spacing');
  }
  chord.forEach((note, v) => {
    if (!inRange(NAMES[v]!, note)) c.add(n, [NAMES[v]!], 'range');
  });
  if (chord.filter((x) => pitchClass(x) === c.leadingPc).length > 1) {
    c.add(
      n,
      NAMES.filter((_, v) => pitchClass(chord[v]!) === c.leadingPc),
      'doubledLeadingTone',
    );
  }
  const pcs = new Set(chord.map((x) => pitchClass(x)));
  const [first, second] = [...pcs];
  // Two pitch classes make a chord without a third when they are a unison, a fourth, or a fifth apart.
  if (pcs.size === 1 || (pcs.size === 2 && [5, 7].includes(Math.abs((second! - first!) % 12))))
    c.add(n, [], 'incomplete');
}

/** Parallel perfect intervals between every pair of voices, and direct fifths and octaves in the outer voices. */
function checkPairs(c: Context, a: Chord, b: Chord, at: number): void {
  for (const [hi, lo] of PAIRS) {
    const before = perfectKind(a[hi]!, a[lo]!);
    const after = perfectKind(b[hi]!, b[lo]!);
    const movedHi = dir(a[hi]!, b[hi]!);
    const movedLo = dir(a[lo]!, b[lo]!);
    const voices = [NAMES[hi]!, NAMES[lo]!];
    const together = movedHi !== 0 && movedHi === movedLo;
    if (before && after && before === after && together) {
      c.add(at, voices, before === 'P5' ? 'parallelFifths' : before === 'P8' ? 'parallelOctaves' : 'parallelUnisons');
    }
    // Direct (hidden) fifths and octaves: the outer voices arrive on a perfect interval by similar motion, with a leap
    // in the soprano.
    const leap = Math.abs(semis(b[0]!) - semis(a[0]!)) > 2;
    if (c.standard && hi === 0 && lo === 3 && after && after !== 'P1' && before !== after && together && leap) {
      c.add(at, voices, after === 'P5' ? 'directFifths' : 'directOctaves');
    }
  }
}

/** Problems in how one voice moves: augmented steps, big leaps, overlap, and leaps that are not recovered. */
function checkVoice(c: Context, k: number, v: number): void {
  const a = c.chords[k - 1]!;
  const b = c.chords[k]!;
  const at = k + 1;
  const step = Math.abs(semis(b[v]!) - semis(a[v]!));
  const moved = between(a[v]!, b[v]!).interval;
  // A chromatic semitone (an augmented unison or octave) is not an augmented melodic interval in the textbook sense.
  if (moved.quality === 'A' && step > 0 && (moved.generic - 1) % 7 !== 0) c.add(at, [NAMES[v]!], 'augmented');
  const limit = v !== 3 && c.strict ? 8 : 12;
  if (c.standard && step > limit) c.add(at, [NAMES[v]!], 'largeLeap');
  // Overlap: a voice moves past where its neighbor just was.
  if (c.standard && v > 0 && semis(b[v]!) > semis(a[v - 1]!)) c.add(at, [NAMES[v - 1]!, NAMES[v]!], 'overlap');
  if (c.standard && v < 3 && semis(b[v]!) < semis(a[v + 1]!)) c.add(at, [NAMES[v]!, NAMES[v + 1]!], 'overlap');
  if (c.strict && k >= 2 && v !== 3) {
    const leap = semis(a[v]!) - semis(c.chords[k - 2]![v]!);
    const next = semis(b[v]!) - semis(a[v]!);
    const recovered = Math.abs(next) <= 2 && Math.sign(next) === -Math.sign(leap);
    if (Math.abs(leap) > 5 && !recovered) c.add(at - 1, [NAMES[v]!], 'leapRecovery');
  }
}

/** Chordal sevenths resolve down by step; the leading tone of a dominant chord rises to the tonic. */
function checkResolutions(c: Context, k: number, numeral: string): void {
  const chord = c.chords[k]!;
  const next = c.chords[k + 1];
  if (!next) return;
  // A repeated chord resolves nothing yet: the check moves on to the repeat, and so to the first different chord.
  const same = new Set(chord.map((x) => pitchClass(x)));
  if (
    next.length === chord.length &&
    next.every((x) => same.has(pitchClass(x))) &&
    new Set(next.map((x) => pitchClass(x))).size === same.size
  )
    return;
  const reading = nameChord([chord[3], chord[2], chord[1], chord[0]], { analysis: true })[0];
  const seventh = reading?.quality.degrees.split(' ').find((d) => /^b*7$/.test(d));
  if (reading && seventh) {
    const seventhPc = (pitchClass(reading.root) + sevenSemis(seventh)) % 12;
    chord.forEach((note, v) => {
      const fell = semis(note) - semis(next[v]!);
      if (pitchClass(note) === seventhPc && fell !== 1 && fell !== 2) c.add(k + 2, [NAMES[v]!], 'seventh');
    });
  }
  if (!c.standard || !/^(V|vii)/.test(numeral)) return;
  chord.forEach((note, v) => {
    if (pitchClass(note) !== c.leadingPc) return;
    const rises = semis(next[v]!) - semis(note);
    // An inner voice may fall a third to the fifth of the tonic chord (the "frustrated" leading tone) unless strict.
    const checked = v === 0 || (c.strict && (v === 1 || v === 2));
    if (checked && rises !== 1 && rises !== 2) c.add(k + 2, [NAMES[v]!], 'leadingTone');
  });
}

/** The cadence the last two chords make, from their Roman numerals. */
function cadenceOf(chords: readonly Chord[], numerals: readonly string[], tonic: Pc): Report['cadence'] {
  const last = chords.length - 1;
  if (last < 1) return 'none';
  const a = numerals[last - 1] ?? '';
  const b = numerals[last] ?? '';
  const tonicChord = /^(I|i)(?![iv])/.test(b);
  const rootPosition = (i: number): boolean => /^[VvIi]+[^0-9/]*$/.test(numerals[i] ?? '') || numerals[i] === 'V7';
  if (/^V/.test(a) && tonicChord) {
    const tonicPc = pitchClass(tonic);
    const ends = pitchClass(chords[last]![0]) === tonicPc && pitchClass(chords[last]![3]) === tonicPc;
    return rootPosition(last - 1) && rootPosition(last) && ends ? 'perfectAuthentic' : 'authentic';
  }
  if (/^(IV|iv)/.test(a) && tonicChord) return 'plagal';
  if (/^V/.test(a) && /^(vi|VI)/.test(b)) return 'deceptive';
  return /^V/.test(b) ? 'half' : 'none';
}

export function checkChorale(chords: readonly Chord[], tonic: Pc, mode: Mode, level: Strictness): Report {
  const issues: Issue[] = [];
  const c: Context = {
    chords,
    tonic,
    leadingPc: (((pitchClass(tonic) - 1) % 12) + 12) % 12,
    standard: level !== 'relaxed',
    strict: level === 'strict',
    add(chord, voices, rule) {
      if (!issues.some((i) => i.chord === chord && i.rule === rule && i.voices.join() === voices.join()))
        issues.push({ chord, voices, rule });
    },
  };
  chords.forEach((chord, k) => checkWithin(c, chord, k + 1));
  for (let k = 1; k < chords.length; k++) {
    checkPairs(c, chords[k - 1]!, chords[k]!, k + 1);
    for (let v = 0; v < 4; v++) checkVoice(c, k, v);
  }
  const read = chords.map((x) => analyze(tonic, mode, [x[3], x[2], x[1], x[0]]));
  const numerals = read.map((r) => r?.numeral ?? '?');
  chords.forEach((_, k) => checkResolutions(c, k, read[k]?.numeral ?? ''));
  issues.sort((x, y) => x.chord - y.chord);
  return {
    issues,
    numerals,
    cadence: cadenceOf(
      chords,
      read.map((r) => r?.numeral ?? ''),
      tonic,
    ),
  };
}

/** Semitones from the root to the seventh of a chord from its degree list. */
function sevenSemis(seventh: string): number {
  if (seventh === '7') return 11;
  if (seventh === 'bb7') return 9;
  return 10;
}

export const describeIssue = (issue: Issue): string => {
  const who = issue.voices.length > 0 ? issue.voices.join('–') : 'chord';
  return `${who}: ${RULE_TEXT[issue.rule]}`;
};

export const noteText = (c: Chord): string => c.map((n) => noteName(n)).join(' ');
export const tonicName = (tonic: Pc): string => pitchClassName(tonic);
