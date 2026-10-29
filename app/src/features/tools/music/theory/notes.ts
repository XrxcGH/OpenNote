// Spelled notes and intervals. A note keeps its letter, its accidental, and its octave, so C to G flat is a
// diminished fifth and C to F sharp is an augmented fourth even though both span six semitones.
import { midiToHz } from '../pitch';

export interface Note {
  /** Letter: 0 is C, 1 is D, up to 6 for B. */
  step: number;
  /** Semitones above (+) or below (−) the letter: 1 is sharp, −1 is flat. */
  alt: number;
  octave: number;
}

export const LETTERS = 'CDEFGAB';
/** Semitones from C to each letter, and from a tonic to each degree of its major scale. */
export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;

export const SHARP = '♯';
export const FLAT = '♭';

/** The accidental written after a letter: ♯, ♭, 𝄪, 𝄫, or nothing. */
export function accidental(alt: number): string {
  if (alt === 0) return '';
  if (alt === 2) return '𝄪';
  if (alt === -2) return '𝄫';
  return (alt > 0 ? SHARP : FLAT).repeat(Math.abs(alt));
}

export const pitchClassName = (note: Pick<Note, 'step' | 'alt'>): string =>
  `${LETTERS[note.step]}${accidental(note.alt)}`;
export const noteName = (note: Note): string => `${pitchClassName(note)}${note.octave}`;

/** The note a letter-and-accidental text names, such as "F#", "Bb", "e-flat", or "C𝄪"; null when it is not one. */
export function parsePitchClass(text: string): Pick<Note, 'step' | 'alt'> | null {
  const match = /^([A-Ga-g])\s*(.*)$/.exec(text.trim());
  if (!match) return null;
  const step = LETTERS.indexOf(match[1]!.toUpperCase());
  let rest = match[2]!.toLowerCase().replace(/[\s-]+/g, '');
  let alt = 0;
  const words: [string, number][] = [
    ['doublesharp', 2],
    ['doubleflat', -2],
    ['sharp', 1],
    ['flat', -1],
    ['natural', 0],
  ];
  for (const [word, value] of words) {
    if (rest === word) return { step, alt: value };
  }
  rest = rest.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/𝄪/g, 'x').replace(/𝄫/g, 'bb').replace(/♮/g, '');
  if (!/^(#*|b*|x|x#|)$/.test(rest)) return null;
  if (rest.startsWith('#')) alt = rest.length;
  else if (rest.startsWith('b')) alt = -rest.length;
  else if (rest === 'x') alt = 2;
  else if (rest === 'x#') alt = 3;
  if (Math.abs(alt) > 3) return null;
  return { step, alt };
}

/** A note such as C4, F#3, or Bb5. Without an octave the note is in the given default octave. */
export function parseNote(text: string, defaultOctave?: number): Note | null {
  const match = /^(.*?)(-?\d+)?$/.exec(text.trim());
  if (!match) return null;
  const head = match[1]!;
  const octaveText = match[2];
  // "Bb-3" would read the minus as a flat sign; a trailing "-n" is only an octave when a letter and accidental precede.
  const pc = parsePitchClass(head);
  if (!pc) return null;
  if (octaveText === undefined) return defaultOctave === undefined ? null : { ...pc, octave: defaultOctave };
  return { ...pc, octave: Number(octaveText) };
}

export const diatonic = (n: Note): number => n.octave * 7 + n.step;
/** Semitones from C−1 as a count, so C4 is 48; the MIDI number is this plus 12. */
export const semitones = (n: Note): number => n.octave * 12 + MAJOR[n.step]! + n.alt;
export const midiOf = (n: Note): number => semitones(n) + 12;
export const hzOf = (n: Note, a4 = 440): number => midiToHz(midiOf(n), a4);
export const pitchClass = (n: Pick<Note, 'step' | 'alt'>): number => (((MAJOR[n.step]! + n.alt) % 12) + 12) % 12;

// --- intervals -------------------------------------------------------------------------------------------------

export type Quality = 'P' | 'M' | 'm' | 'A' | 'd';

export interface Interval {
  /** 1 is a unison, 2 a second, 8 an octave, 9 a ninth. */
  generic: number;
  quality: Quality;
  /** How many times augmented or diminished: 1 for A, 2 for AA. */
  times: number;
  semitones: number;
}

const PERFECT_TYPE = new Set([0, 3, 4]);
const GENERIC_NAMES = [
  '',
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'double octave',
];

/** The quality of the interval that spans a generic size and a count of semitones. */
export function qualityOf(generic: number, semis: number): Pick<Interval, 'quality' | 'times'> {
  const simple = (generic - 1) % 7;
  const octaves = Math.floor((generic - 1) / 7);
  const diff = semis - (MAJOR[simple]! + 12 * octaves);
  if (PERFECT_TYPE.has(simple)) {
    if (diff === 0) return { quality: 'P', times: 0 };
    return diff > 0 ? { quality: 'A', times: diff } : { quality: 'd', times: -diff };
  }
  if (diff === 0) return { quality: 'M', times: 0 };
  if (diff === -1) return { quality: 'm', times: 0 };
  return diff > 0 ? { quality: 'A', times: diff } : { quality: 'd', times: -diff - 1 };
}

/** The semitones in an interval with a quality and generic size. */
export function semitonesOf(generic: number, quality: Quality, times = 1): number {
  const simple = (generic - 1) % 7;
  const base = MAJOR[simple]! + 12 * Math.floor((generic - 1) / 7);
  if (quality === 'P' || quality === 'M') return base;
  if (quality === 'm') return base - 1;
  if (quality === 'A') return base + times;
  return base - times - (PERFECT_TYPE.has(simple) ? 0 : 1);
}

export function makeInterval(generic: number, semis: number): Interval {
  return { generic, semitones: semis, ...qualityOf(generic, semis) };
}

/** The ascending interval from the lower to the higher of two notes, and whether the first note is the higher one. */
export function between(a: Note, b: Note): { interval: Interval; descending: boolean } {
  const descending = diatonic(b) < diatonic(a) || (diatonic(b) === diatonic(a) && semitones(b) < semitones(a));
  const [low, high] = descending ? [b, a] : [a, b];
  return {
    interval: makeInterval(diatonic(high) - diatonic(low) + 1, semitones(high) - semitones(low)),
    descending,
  };
}

const QUALITY_WORDS: Record<Quality, string> = {
  P: 'perfect',
  M: 'major',
  m: 'minor',
  A: 'augmented',
  d: 'diminished',
};

/** "major tenth", "perfect fifth", or "doubly augmented fourth". */
export function intervalWords(i: Interval): string {
  const prefix = i.times === 2 ? 'doubly ' : i.times === 3 ? 'triply ' : '';
  const generic = GENERIC_NAMES[i.generic] ?? `${i.generic}th`;
  return `${prefix}${QUALITY_WORDS[i.quality]} ${generic}`;
}

/** The short name, such as M10, P5, d5, or AA4. */
export const intervalShort = (i: Interval): string =>
  `${i.quality === 'A' || i.quality === 'd' ? i.quality.repeat(i.times) : i.quality}${i.generic}`;

/** The interval inside one octave that makes an octave with this one: a third inverts to a sixth. */
export function invert(i: Interval): Interval {
  const k = Math.floor((i.generic - 1) / 7);
  const simple = ((i.generic - 1) % 7) + 1;
  if (simple === 1) return makeInterval(k === 0 ? 8 : 1, 12 - i.semitones);
  return makeInterval(9 - simple, 12 - (i.semitones - 12 * k));
}

/** Reads "M3", "P5", "m10", "d5", "A4", or "AA4"; null when the text is not an interval name. */
export function parseInterval(text: string): Interval | null {
  const match = /^(P|M|m|AA?A?|dd?d?|A|d)\s*(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const letter = match[1]!;
  const generic = Number(match[2]);
  if (generic < 1 || generic > 15) return null;
  const perfectType = PERFECT_TYPE.has((generic - 1) % 7);
  const quality = letter[0] as Quality;
  if (quality === 'P' && !perfectType) return null;
  if ((quality === 'M' || quality === 'm') && perfectType) return null;
  const times = letter.length;
  const semis = semitonesOf(generic, quality, times);
  return { generic, quality, times: quality === 'A' || quality === 'd' ? times : 0, semitones: semis };
}

/** The note an interval above (or below) a note, spelled by the interval's letter distance. */
export function transposeNote(n: Note, interval: Interval, down = false): Note {
  const direction = down ? -1 : 1;
  const target = diatonic(n) + direction * (interval.generic - 1);
  const step = ((target % 7) + 7) % 7;
  const octave = Math.floor(target / 7);
  const wanted = semitones(n) + direction * interval.semitones;
  return { step, octave, alt: wanted - (octave * 12 + MAJOR[step]!) };
}

/** Transposes by a letter distance and a semitone count that may be negative. */
export function shift(n: Note, letters: number, semis: number): Note {
  const target = diatonic(n) + letters;
  const step = ((target % 7) + 7) % 7;
  const octave = Math.floor(target / 7);
  return { step, octave, alt: semitones(n) + semis - (octave * 12 + MAJOR[step]!) };
}

/** Every spelling of the same pitch with at most a double accidental, other than the note itself. */
export function enharmonics(n: Note): Note[] {
  const out: Note[] = [];
  const target = semitones(n);
  for (let step = 0; step < 7; step++) {
    for (const octave of [n.octave - 1, n.octave, n.octave + 1]) {
      const alt = target - (octave * 12 + MAJOR[step]!);
      if (Math.abs(alt) <= 2 && !(step === n.step && alt === n.alt && octave === n.octave)) {
        out.push({ step, alt, octave });
      }
    }
  }
  return out.sort((x, y) => Math.abs(x.alt) - Math.abs(y.alt) || x.step - y.step);
}

/** A degree written like "b3", "#4", "bb7", "9", or "13": its letter distance and semitones above the tonic. */
export function parseDegree(token: string): { generic: number; semis: number } | null {
  const match = /^(#{0,2}|b{0,2})(\d{1,2})$/.exec(token);
  if (!match) return null;
  const generic = Number(match[2]);
  if (generic < 1 || generic > 15) return null;
  const alt = match[1]!.startsWith('#') ? match[1]!.length : -match[1]!.length;
  const simple = (generic - 1) % 7;
  return { generic, semis: MAJOR[simple]! + 12 * Math.floor((generic - 1) / 7) + alt };
}

/** The note a scale degree token names above a tonic. */
export function degreeNote(tonic: Note, token: string): Note {
  const d = parseDegree(token);
  if (!d) throw new Error(`bad degree ${token}`);
  return shift(tonic, d.generic - 1, d.semis);
}
