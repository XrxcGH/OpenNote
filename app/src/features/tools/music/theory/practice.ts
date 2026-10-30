// The practical side of theory: transposing instruments, chord-scale choices for jazz, ii-V-I progressions in any key,
// and guitar chord shapes found by searching the fretboard of a standard-tuned guitar.
import { chordSymbol, quality, spellChord } from './chords';
import type { ChordQuality } from './chords';
import { keyNotes } from './keys';
import type { Mode, Pc } from './keys';
import { makeInterval, parseNote, pitchClass, transposeNote } from './notes';
import type { Note } from './notes';
import { SCALES, spellScale } from './scales';

// --- transposing instruments ---------------------------------------------------------------------------------------

export interface Instrument {
  id: string;
  name: string;
  /** How far above the sounding note the part is written, as a letter distance and a count of semitones. May be below
   * (negative) for an instrument that sounds higher than it is written. */
  up: { generic: number; semitones: number; down?: boolean };
  /** The written range from the lowest note to the highest, in common orchestration ranges rounded for teaching. */
  low: string;
  high: string;
}

export const INSTRUMENTS: readonly Instrument[] = [
  { id: 'clarinetBb', name: 'Clarinet in B♭', up: { generic: 2, semitones: 2 }, low: 'E3', high: 'G6' },
  { id: 'clarinetA', name: 'Clarinet in A', up: { generic: 3, semitones: 3 }, low: 'E3', high: 'G6' },
  { id: 'trumpetBb', name: 'Trumpet in B♭', up: { generic: 2, semitones: 2 }, low: 'F♯3', high: 'C6' },
  { id: 'sopranoSax', name: 'Soprano saxophone (B♭)', up: { generic: 2, semitones: 2 }, low: 'B♭3', high: 'F6' },
  { id: 'altoSax', name: 'Alto saxophone (E♭)', up: { generic: 6, semitones: 9 }, low: 'B♭3', high: 'F6' },
  { id: 'tenorSax', name: 'Tenor saxophone (B♭)', up: { generic: 9, semitones: 14 }, low: 'B♭3', high: 'F6' },
  { id: 'baritoneSax', name: 'Baritone saxophone (E♭)', up: { generic: 13, semitones: 21 }, low: 'B♭3', high: 'F6' },
  { id: 'hornF', name: 'Horn in F', up: { generic: 5, semitones: 7 }, low: 'F♯3', high: 'C6' },
  { id: 'englishHorn', name: 'English horn (F)', up: { generic: 5, semitones: 7 }, low: 'B3', high: 'G6' },
  { id: 'piccolo', name: 'Piccolo', up: { generic: 8, semitones: 12, down: true }, low: 'D4', high: 'C7' },
  { id: 'guitar', name: 'Guitar', up: { generic: 8, semitones: 12 }, low: 'E3', high: 'C6' },
  { id: 'doubleBass', name: 'Double bass', up: { generic: 8, semitones: 12 }, low: 'E2', high: 'G5' },
];

export const instrument = (id: string): Instrument => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0]!;

const shiftOf = (i: Instrument) => makeInterval(i.up.generic, i.up.semitones);

/** The note to write for a sounding (concert) note. */
export const writtenNote = (concert: Note, i: Instrument): Note =>
  transposeNote(concert, shiftOf(i), i.up.down === true);
/** The sounding note for a written one. */
export const concertNote = (written: Note, i: Instrument): Note =>
  transposeNote(written, shiftOf(i), i.up.down !== true);

const nameToNote = (text: string): Note => parseNote(text.replace(/♯/g, '#').replace(/♭/g, 'b'))!;

/** The written range and the sounding range of an instrument. */
export function ranges(i: Instrument): { written: [Note, Note]; concert: [Note, Note] } {
  const written: [Note, Note] = [nameToNote(i.low), nameToNote(i.high)];
  return { written, concert: [concertNote(written[0], i), concertNote(written[1], i)] };
}

// --- jazz: chord-scales and ii-V-I ---------------------------------------------------------------------------------------

/** Scales used in jazz that the general scale list does not have, written as degrees above the root. */
const EXTRA: Record<string, { name: string; degrees: string }> = {
  lydianDominant: { name: 'Lydian dominant', degrees: '1 2 3 #4 5 6 b7' },
  altered: { name: 'Altered scale', degrees: '1 b2 b3 b4 b5 b6 b7' },
  phrygianDominant: { name: 'Phrygian dominant', degrees: '1 b2 3 4 5 b6 b7' },
  locrianNatural2: { name: 'Locrian natural 2', degrees: '1 2 b3 4 b5 b6 b7' },
  lydianAugmented: { name: 'Lydian augmented', degrees: '1 2 3 #4 #5 6 7' },
};

const SCALE_NAMES: Record<string, string> = {
  ionian: 'Ionian (major)',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  aeolian: 'Aeolian (natural minor)',
  locrian: 'Locrian',
  harmonicMinor: 'Harmonic minor',
  melodicMinor: 'Melodic minor',
  majorPentatonic: 'Major pentatonic',
  minorPentatonic: 'Minor pentatonic',
  blues: 'Blues scale',
  wholeTone: 'Whole-tone',
  octatonicWH: 'Octatonic (whole-half)',
  octatonicHW: 'Octatonic (half-whole)',
  bebopDominant: 'Bebop dominant',
  bebopMajor: 'Bebop major',
};

/** The English name of a scale id used by the chord-scale table. */
export const scaleLabel = (id: string): string => EXTRA[id]?.name ?? SCALE_NAMES[id] ?? id;

const scaleDegrees = (id: string): string => EXTRA[id]?.degrees ?? SCALES.find((s) => s.id === id)!.degrees;

const CHORD_SCALES: Record<string, string[]> = {
  major: ['ionian', 'lydian', 'majorPentatonic'],
  major6: ['ionian', 'lydian', 'bebopMajor'],
  major7: ['ionian', 'lydian'],
  major9: ['ionian', 'lydian'],
  major13: ['ionian', 'lydian'],
  add9: ['ionian', 'lydian'],
  minor: ['dorian', 'aeolian', 'minorPentatonic'],
  minor6: ['dorian', 'melodicMinor'],
  minor7: ['dorian', 'aeolian', 'phrygian'],
  minor9: ['dorian', 'aeolian'],
  minor11: ['dorian', 'aeolian'],
  minorMajor7: ['melodicMinor', 'harmonicMinor'],
  dominant7: ['mixolydian', 'bebopDominant', 'lydianDominant', 'blues'],
  dominant9: ['mixolydian', 'lydianDominant'],
  dominant11: ['mixolydian'],
  dominant13: ['mixolydian', 'lydianDominant'],
  dominant7flat5: ['lydianDominant', 'altered'],
  dominant7flat9: ['octatonicHW', 'phrygianDominant', 'altered'],
  dominant7sharp9: ['altered', 'octatonicHW'],
  dominant7sus4: ['mixolydian', 'dorian'],
  sus4: ['mixolydian', 'dorian'],
  sus2: ['mixolydian', 'ionian'],
  augmented: ['wholeTone', 'lydianAugmented'],
  augmented7: ['wholeTone', 'altered'],
  halfDiminished7: ['locrian', 'locrianNatural2'],
  diminished: ['locrian', 'octatonicWH'],
  diminished7: ['octatonicWH'],
  power: ['minorPentatonic', 'majorPentatonic'],
};

export interface ChordScale {
  id: string;
  name: string;
  notes: Note[];
}

/** The scales that fit a chord, spelled from its root. The first is the usual first choice. */
export function chordScales(root: Note, q: ChordQuality): ChordScale[] {
  return (CHORD_SCALES[q.id] ?? ['ionian']).map((id) => ({
    id,
    name: scaleLabel(id),
    notes: spellScale(root, scaleDegrees(id)),
  }));
}

export interface ProgressionChord {
  numeral: string;
  symbol: string;
  notes: Note[];
}

/** The ii-V-I in a key: ii7, V7, and Imaj7 in a major key; iiø7, V7, and i7 in a minor key. */
export function twoFiveOne(tonic: Pc, mode: Mode): ProgressionChord[] {
  const scale = keyNotes(tonic, mode);
  const ids = mode === 'major' ? ['minor7', 'dominant7', 'major7'] : ['halfDiminished7', 'dominant7', 'minor7'];
  const numerals = mode === 'major' ? ['ii7', 'V7', 'Imaj7'] : ['iiø7', 'V7', 'i7'];
  return [1, 4, 0].map((degree, i) => {
    const q = quality(ids[i]!);
    const root = scale[degree]!;
    return { numeral: numerals[i]!, symbol: chordSymbol(root, q), notes: spellChord(root, q) };
  });
}

// --- guitar chord shapes -------------------------------------------------------------------------------------------------

/** The open strings of a guitar in standard tuning, low to high, as MIDI numbers: E2 A2 D3 G3 B3 E4. */
export const GUITAR_STRINGS = [40, 45, 50, 55, 59, 64] as const;

export interface GuitarShape {
  /** Fret for each string from the low E to the high E: a number, or -1 for a string that is not played. */
  frets: number[];
  /** The note on each played string. */
  notes: string[];
  /** The lowest fret that is pressed down (0 if the shape is all open or muted). */
  position: number;
}

const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Shapes for a chord with the fingers inside four frets, found by search. Every chord tone except possibly the fifth
 * sounds, the lowest played string is the root (or the slash-chord bass), and the strings played are next to each
 * other. The list is ordered with the easiest shapes first. */
export function guitarShapes(root: Pc, q: ChordQuality, bass?: Pc | null, limit = 4): GuitarShape[] {
  const rootPc = pitchClass(root);
  const tones = [...new Set(spellChord({ ...root, octave: 4 }, q).map((n) => pitchClass(n)))];
  const fifth = (rootPc + 7) % 12;
  const need = new Set(tones.length >= 4 && tones.includes(fifth) ? tones.filter((t) => t !== fifth) : tones);
  const bassPc = bass ? pitchClass(bass) : rootPc;
  const found: { shape: GuitarShape; score: number }[] = [];
  const seen = new Set<string>();
  for (let position = 1; position <= 12; position++) {
    const options = [-1, ...(position <= 4 ? [0] : []), ...[0, 1, 2, 3].map((d) => position + d)];
    const frets = [0, 0, 0, 0, 0, 0];
    const walk = (s: number): void => {
      if (s === 6) {
        evaluate(frets);
        return;
      }
      for (const f of options) {
        frets[s] = f;
        walk(s + 1);
      }
    };
    const evaluate = (fr: number[]): void => {
      const played = fr.map((f, i) => (f < 0 ? -1 : GUITAR_STRINGS[i]! + f));
      const first = played.findIndex((m) => m >= 0);
      if (first < 0) return;
      let last = 5;
      while (played[last]! < 0) last--;
      let inside = true;
      for (let i = first; i <= last; i++) if (played[i]! < 0) inside = false;
      if (!inside) return;
      const count = last - first + 1;
      if (count < Math.min(3, tones.length) || (tones.length >= 3 && count < 4 && q.id !== 'power')) return;
      if (played[first]! % 12 !== bassPc) return;
      const have = new Set(played.filter((m) => m >= 0).map((m) => m % 12));
      for (const t of need) if (!have.has(t)) return;
      for (const m of have) if (!tones.includes(m) && !(bass && m === bassPc)) return;
      const pressed = fr.filter((f) => f > 0);
      const lowest = pressed.length ? Math.min(...pressed) : 0;
      const key = fr.join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const open = fr.filter((f) => f === 0).length;
      const muted = fr.filter((f) => f < 0).length;
      const span = pressed.length ? Math.max(...pressed) - lowest : 0;
      const score = lowest * 3 + span * 2 + muted * 2 - open * 2 + (pressed.length > 4 ? 6 : 0);
      found.push({
        shape: {
          frets: [...fr],
          position: lowest,
          notes: played.map((m, i) => (fr[i]! < 0 ? '' : FLAT_NAMES[m % 12]!)).filter((x) => x !== ''),
        },
        score,
      });
    };
    walk(0);
  }
  return found
    .sort((a, b) => a.score - b.score || a.shape.frets.join().localeCompare(b.shape.frets.join()))
    .slice(0, limit)
    .map((f) => f.shape);
}

/** A shape written the usual way, low string first, such as x32010. */
export const shapeText = (shape: GuitarShape): string =>
  shape.frets.map((f) => (f < 0 ? 'x' : f > 9 ? `(${f})` : String(f))).join('');
