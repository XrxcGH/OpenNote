// Scales and modes. A scale written as degrees ("1 2 b3 4 5 b6 b7") is spelled above any tonic, so A flat harmonic
// minor has a G natural and not an F double sharp. Maqam and gamelan tunings are listed in cents, and they are
// approximations: players and instruments differ.
import { degreeNote, noteName, parseDegree, shift } from './notes';
import type { Note } from './notes';

export const SOURCES = {
  scales: 'Standard Western scale and mode definitions; thaat after V. N. Bhatkhande; melakarta numbering by rule',
  maqam: 'Approximate cents after common teaching tables for Arab music; tunings vary by region and player',
  gamelan: 'Approximate cents of nominal pelog and slendro; every gamelan is tuned differently',
};

export interface ScaleDef {
  id: string;
  family: 'western' | 'thaat' | 'japanese' | 'chinese';
  /** Degrees above the tonic, such as "1 2 b3 4 5 b6 b7". */
  degrees: string;
}

export const SCALES: readonly ScaleDef[] = [
  { id: 'ionian', family: 'western', degrees: '1 2 3 4 5 6 7' },
  { id: 'dorian', family: 'western', degrees: '1 2 b3 4 5 6 b7' },
  { id: 'phrygian', family: 'western', degrees: '1 b2 b3 4 5 b6 b7' },
  { id: 'lydian', family: 'western', degrees: '1 2 3 #4 5 6 7' },
  { id: 'mixolydian', family: 'western', degrees: '1 2 3 4 5 6 b7' },
  { id: 'aeolian', family: 'western', degrees: '1 2 b3 4 5 b6 b7' },
  { id: 'locrian', family: 'western', degrees: '1 b2 b3 4 b5 b6 b7' },
  { id: 'harmonicMinor', family: 'western', degrees: '1 2 b3 4 5 b6 7' },
  { id: 'melodicMinor', family: 'western', degrees: '1 2 b3 4 5 6 7' },
  { id: 'majorPentatonic', family: 'western', degrees: '1 2 3 5 6' },
  { id: 'minorPentatonic', family: 'western', degrees: '1 b3 4 5 b7' },
  { id: 'blues', family: 'western', degrees: '1 b3 4 b5 5 b7' },
  { id: 'wholeTone', family: 'western', degrees: '1 2 3 #4 #5 b7' },
  { id: 'octatonicWH', family: 'western', degrees: '1 2 b3 4 b5 b6 6 7' },
  { id: 'octatonicHW', family: 'western', degrees: '1 b2 b3 3 #4 5 6 b7' },
  { id: 'bebopDominant', family: 'western', degrees: '1 2 3 4 5 6 b7 7' },
  { id: 'bebopMajor', family: 'western', degrees: '1 2 3 4 5 b6 6 7' },
  { id: 'bilawal', family: 'thaat', degrees: '1 2 3 4 5 6 7' },
  { id: 'khamaj', family: 'thaat', degrees: '1 2 3 4 5 6 b7' },
  { id: 'kafi', family: 'thaat', degrees: '1 2 b3 4 5 6 b7' },
  { id: 'asavari', family: 'thaat', degrees: '1 2 b3 4 5 b6 b7' },
  { id: 'bhairavi', family: 'thaat', degrees: '1 b2 b3 4 5 b6 b7' },
  { id: 'bhairav', family: 'thaat', degrees: '1 b2 3 4 5 b6 7' },
  { id: 'kalyan', family: 'thaat', degrees: '1 2 3 #4 5 6 7' },
  { id: 'marwa', family: 'thaat', degrees: '1 b2 3 #4 5 6 7' },
  { id: 'poorvi', family: 'thaat', degrees: '1 b2 3 #4 5 b6 7' },
  { id: 'todi', family: 'thaat', degrees: '1 b2 b3 #4 5 b6 7' },
  { id: 'hirajoshi', family: 'japanese', degrees: '1 2 b3 5 b6' },
  { id: 'insen', family: 'japanese', degrees: '1 b2 4 5 b7' },
  { id: 'yo', family: 'japanese', degrees: '1 2 4 5 6' },
  { id: 'iwato', family: 'japanese', degrees: '1 b2 4 b5 b7' },
  { id: 'miyako', family: 'japanese', degrees: '1 b2 4 5 b6' },
  { id: 'gong', family: 'chinese', degrees: '1 2 3 5 6' },
  { id: 'shang', family: 'chinese', degrees: '1 2 4 5 b7' },
  { id: 'jue', family: 'chinese', degrees: '1 b3 4 b6 b7' },
  { id: 'zhi', family: 'chinese', degrees: '1 2 4 5 6' },
  { id: 'yu', family: 'chinese', degrees: '1 b3 4 5 b7' },
];

export const scaleDef = (id: string): ScaleDef => SCALES.find((s) => s.id === id) ?? SCALES[0]!;

/** The notes of a scale from a tonic, one octave plus the octave note. */
export function spellScale(tonic: Note, degrees: string): Note[] {
  const notes = degrees.split(' ').map((token) => degreeNote(tonic, token));
  return [...notes, shift(tonic, 7, 12)];
}

/** Semitones above the tonic of each degree. */
export const scaleSemitones = (degrees: string): number[] =>
  degrees.split(' ').map((token) => parseDegree(token)!.semis);

/** The note names of a scale, such as "C D E♭ F G A♭ B C". */
export const scaleNames = (notes: readonly Note[]): string =>
  notes.map((n) => noteName(n).replace(/-?\d+$/, '')).join(' ');

// --- sargam ----------------------------------------------------------------------------------------------------

const SARGAM_PLAIN = ['S', 'R', 'G', 'M', 'P', 'D', 'N'] as const;

/** Hindustani note names for degrees: lower case for komal (flat) and M for tivra (raised fourth). */
export function sargam(degrees: string): string[] {
  return degrees.split(' ').map((token) => {
    const d = parseDegree(token)!;
    const base = SARGAM_PLAIN[(d.generic - 1) % 7]!;
    const natural = [0, 2, 4, 5, 7, 9, 11][(d.generic - 1) % 7]!;
    const alt = d.semis - natural;
    if (d.generic === 4) return alt > 0 ? 'M♯' : 'M';
    if (d.generic === 1 || d.generic === 5) return base;
    return alt < 0 ? base.toLowerCase() : base;
  });
}

// --- Carnatic melakarta ------------------------------------------------------------------------------------------

export interface Melakarta {
  number: number;
  /** Semitones above Sa of Sa Ri Ga Ma Pa Da Ni. */
  semitones: number[];
  names: string[];
}

const RI_GA: readonly (readonly [number, number, string, string])[] = [
  [1, 2, 'R1', 'G1'],
  [1, 3, 'R1', 'G2'],
  [1, 4, 'R1', 'G3'],
  [2, 3, 'R2', 'G2'],
  [2, 4, 'R2', 'G3'],
  [3, 4, 'R3', 'G3'],
];
const DA_NI: readonly (readonly [number, number, string, string])[] = [
  [8, 9, 'D1', 'N1'],
  [8, 10, 'D1', 'N2'],
  [8, 11, 'D1', 'N3'],
  [9, 10, 'D2', 'N2'],
  [9, 11, 'D2', 'N3'],
  [10, 11, 'D3', 'N3'],
];

/** The melakarta scale with a number from 1 to 72: the chakra picks Ri and Ga, the place in it picks Da and Ni, and
 * the second half uses the raised Ma. */
export function melakarta(number: number): Melakarta {
  if (!Number.isInteger(number) || number < 1 || number > 72) throw new RangeError('melakarta');
  const index = number - 1;
  const chakra = Math.floor(index / 6);
  const [ri, ga, riName, gaName] = RI_GA[chakra % 6]!;
  const [da, ni, daName, niName] = DA_NI[index % 6]!;
  const high = number > 36;
  return {
    number,
    semitones: [0, ri, ga, high ? 6 : 5, 7, da, ni],
    names: ['S', riName, gaName, high ? 'M2' : 'M1', 'P', daName, niName],
  };
}

/** A melakarta spelled in Western letters above a tonic; Ri and Ga can share a pitch, so the spelling can use a
 * double flat. */
export function spellMelakarta(tonic: Note, m: Melakarta): Note[] {
  const notes = m.semitones.map((s, i) => shift(tonic, i, s));
  return [...notes, shift(tonic, 7, 12)];
}

// --- tunings in cents ----------------------------------------------------------------------------------------------

export interface CentsScale {
  id: string;
  family: 'maqam' | 'gamelan';
  /** Cents above the tonic, from the tonic to the octave when the scale has one. */
  cents: number[];
}

export const CENTS_SCALES: readonly CentsScale[] = [
  { id: 'rast', family: 'maqam', cents: [0, 204, 350, 498, 702, 906, 1052, 1200] },
  { id: 'bayati', family: 'maqam', cents: [0, 150, 294, 498, 702, 792, 996, 1200] },
  { id: 'hijaz', family: 'maqam', cents: [0, 90, 384, 498, 702, 792, 996, 1200] },
  { id: 'nahawand', family: 'maqam', cents: [0, 204, 294, 498, 702, 792, 1086, 1200] },
  { id: 'kurd', family: 'maqam', cents: [0, 90, 294, 498, 702, 792, 996, 1200] },
  { id: 'ajam', family: 'maqam', cents: [0, 204, 408, 498, 702, 906, 1110, 1200] },
  { id: 'slendro', family: 'gamelan', cents: [0, 240, 480, 720, 960, 1200] },
  { id: 'pelog', family: 'gamelan', cents: [0, 120, 270, 540, 670, 785, 950, 1200] },
];

export const centsScale = (id: string): CentsScale => CENTS_SCALES.find((s) => s.id === id) ?? CENTS_SCALES[0]!;

/** The nearest equal-tempered semitone offset of a cents value, and how far off it is. */
export function nearestSemitone(cents: number): { semis: number; off: number } {
  const semis = Math.round(cents / 100);
  return { semis, off: cents - semis * 100 };
}
