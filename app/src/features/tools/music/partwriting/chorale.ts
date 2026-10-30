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

/** Common textbook ranges, lowest and highest note, rounded for teaching. */
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

export function checkChorale(chords: readonly Chord[], tonic: Pc, mode: Mode, level: Strictness): Report {
  const issues: Issue[] = [];
  const add = (chord: number, voices: Voice[], rule: RuleId): void => {
    if (!issues.some((i) => i.chord === chord && i.rule === rule && i.voices.join() === voices.join()))
      issues.push({ chord, voices, rule });
  };
  const standard = level !== 'relaxed';
  const strict = level === 'strict';
  const leadingPc = (((pitchClass(tonic) - 1) % 12) + 12) % 12;
  const names: Voice[] = [...VOICES];

  chords.forEach((chord, k) => {
    const n = k + 1;
    for (let v = 0; v < 3; v++) {
      if (semis(chord[v]!) < semis(chord[v + 1]!)) add(n, [names[v]!, names[v + 1]!], 'crossing');
    }
    if (standard) {
      for (let v = 0; v < 3; v++) {
        if (v < 2 && semis(chord[v]!) - semis(chord[v + 1]!) > 12) add(n, [names[v]!, names[v + 1]!], 'spacing');
      }
      chord.forEach((note, v) => {
        if (!inRange(names[v]!, note)) add(n, [names[v]!], 'range');
      });
      if (chord.filter((c) => pitchClass(c) === leadingPc).length > 1) {
        add(n, names.filter((_, v) => pitchClass(chord[v]!) === leadingPc), 'doubledLeadingTone');
      }
      const pcs = new Set(chord.map((c) => pitchClass(c)));
      const [first, second] = [...pcs];
      // Two pitch classes make a chord without a third when they are a unison, a fourth, or a fifth apart.
      if (pcs.size === 1 || (pcs.size === 2 && [5, 7].includes(Math.abs((second! - first!) % 12)))) add(n, [], 'incomplete');
    }
  });

  for (let k = 1; k < chords.length; k++) {
    const a = chords[k - 1]!;
    const b = chords[k]!;
    const at = k + 1;
    for (const [hi, lo] of PAIRS) {
      const before = perfectKind(a[hi]!, a[lo]!);
      const after = perfectKind(b[hi]!, b[lo]!);
      const movedHi = dir(a[hi]!, b[hi]!);
      const movedLo = dir(a[lo]!, b[lo]!);
      const voices = [names[hi]!, names[lo]!];
      if (before && after && before === after && movedHi !== 0 && movedLo !== 0 && movedHi === movedLo) {
        add(at, voices, before === 'P5' ? 'parallelFifths' : before === 'P8' ? 'parallelOctaves' : 'parallelUnisons');
      }
      if (before === 'P1' && after === 'P1' && (movedHi !== 0 || movedLo !== 0) && movedHi === movedLo) {
        add(at, voices, 'parallelUnisons');
      }
      // Direct (hidden) fifths and octaves: the outer voices arrive on a perfect interval by similar motion, with a leap
      // in the soprano.
      if (standard && hi === 0 && lo === 3 && after && after !== 'P1' && before !== after) {
        const leap = Math.abs(semis(b[0]!) - semis(a[0]!)) > 2;
        if (movedHi !== 0 && movedHi === movedLo && leap) add(at, voices, after === 'P5' ? 'directFifths' : 'directOctaves');
      }
    }
    for (let v = 0; v < 4; v++) {
      const step = Math.abs(semis(b[v]!) - semis(a[v]!));
      const { interval } = between(a[v]!, b[v]!);
      if (interval.quality === 'A' && step > 0) add(at, [names[v]!], 'augmented');
      const limit = v === 3 ? 12 : strict ? 8 : 12;
      if (standard && step > limit) add(at, [names[v]!], 'largeLeap');
      // Overlap: a voice moves past where its neighbor just was.
      if (standard && v > 0 && semis(b[v]!) > semis(a[v - 1]!)) add(at, [names[v - 1]!, names[v]!], 'overlap');
      if (standard && v < 3 && semis(b[v]!) < semis(a[v + 1]!)) add(at, [names[v]!, names[v + 1]!], 'overlap');
      if (strict && k >= 2) {
        const before = chords[k - 2]![v]!;
        const leap = semis(a[v]!) - semis(before);
        if (Math.abs(leap) > 5 && v !== 3) {
          const next = semis(b[v]!) - semis(a[v]!);
          const recovered = Math.abs(next) <= 2 && Math.sign(next) === -Math.sign(leap);
          if (!recovered) add(at - 1, [names[v]!], 'leapRecovery');
        }
      }
    }
  }

  // Chordal sevenths resolve down by step; the leading tone of a dominant chord rises to the tonic.
  const read = chords.map((c) => analyze(tonic, mode, [c[3], c[2], c[1], c[0]]));
  chords.forEach((chord, k) => {
    const next = chords[k + 1];
    const reading = nameChord([chord[3], chord[2], chord[1], chord[0]])[0];
    if (!next) return;
    const seventh = reading?.quality.degrees.split(' ').find((d) => /^b*7$/.test(d));
    if (reading && seventh) {
      const seventhPc = (pitchClass(reading.root) + sevenSemis(seventh)) % 12;
      chord.forEach((note, v) => {
        if (pitchClass(note) !== seventhPc) return;
        const fell = semis(note) - semis(next[v]!);
        const stepDown = fell === 1 || fell === 2;
        if (!stepDown) add(k + 2, [names[v]!], 'seventh');
      });
    }
    const numeral = read[k]?.numeral ?? '';
    if (/^(V|vii)/.test(numeral)) {
      chord.forEach((note, v) => {
        if (pitchClass(note) !== leadingPc) return;
        const rises = semis(next[v]!) - semis(note);
        const inner = v === 1 || v === 2;
        const checked = v === 0 || (strict && inner);
        if (standard && checked && !(rises === 1 || rises === 2)) {
          // The "frustrated" leading tone: an inner voice may fall a third to the fifth of the tonic chord, which
          // standard rules allow.
          add(k + 2, [names[v]!], 'leadingTone');
        }
      });
    }
  });

  const last = chords.length - 1;
  let cadence: Report['cadence'] = 'none';
  if (last >= 1) {
    const a = read[last - 1]?.numeral ?? '';
    const b = read[last]?.numeral ?? '';
    const bassPc = (c: Chord) => pitchClass(c[3]);
    const tonicPc = pitchClass(tonic);
    const rootPosition = (i: number) => /^[VvIi]+[^0-9/]*$/.test(read[i]?.numeral ?? '') || /^V7$/.test(read[i]?.numeral ?? '');
    if (/^V/.test(a) && /^(I|i)(?![iv])/.test(b)) {
      cadence =
        rootPosition(last - 1) && rootPosition(last) && pitchClass(chords[last]![0]) === tonicPc && bassPc(chords[last]!) === tonicPc
          ? 'perfectAuthentic'
          : 'authentic';
    } else if (/^(IV|iv)/.test(a) && /^(I|i)(?![iv])/.test(b)) cadence = 'plagal';
    else if (/^V/.test(a) && /^(vi|VI)/.test(b)) cadence = 'deceptive';
    else if (/^V/.test(b)) cadence = 'half';
  }
  issues.sort((x, y) => x.chord - y.chord);
  return { issues, numerals: read.map((r) => r?.numeral ?? '?'), cadence };
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
