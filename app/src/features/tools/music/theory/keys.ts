// Keys and Roman-numeral analysis: key signatures, relative and parallel keys, the diatonic chords of a key, and the
// numeral for any chord in a key including secondary dominants, borrowed chords, the Neapolitan, and the augmented
// sixth chords.
import { chordSymbol, figuredBass, nameChord, quality, spellChord } from './chords';
import type { ChordMatch } from './chords';
import { MAJOR, pitchClass, pitchClassName, shift, FLAT, SHARP } from './notes';
import type { Note } from './notes';

export type Mode = 'major' | 'minor';
export type Pc = Pick<Note, 'step' | 'alt'>;

const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5] as const;
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6] as const;
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3] as const;
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const;

/** Sharps (positive) or flats (negative) in a key's signature; beyond seven it is a theoretical key. */
export const fifthsOf = (tonic: Pc, mode: Mode): number =>
  LETTER_FIFTHS[tonic.step]! + 7 * tonic.alt - (mode === 'minor' ? 3 : 0);

/** The accidentals of a signature in order, such as ["F♯", "C♯"]; accidentals past seven wrap to double marks. */
export function signature(fifths: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.abs(fifths); i++) {
    const letter = 'CDEFGAB'[(fifths > 0 ? SHARP_ORDER : FLAT_ORDER)[i % 7]!]!;
    const doubled = i >= 7;
    out.push(`${letter}${fifths > 0 ? (doubled ? '𝄪' : SHARP) : doubled ? '𝄫' : FLAT}`);
  }
  return out;
}

export const relativeKey = (tonic: Pc, mode: Mode): Pc =>
  pick(shift({ ...tonic, octave: 4 }, mode === 'major' ? -2 : 2, mode === 'major' ? -3 : 3));
const pick = (n: Note): Pc => ({ step: n.step, alt: n.alt });

export const scaleSemis = (mode: Mode): readonly number[] => (mode === 'major' ? MAJOR : MINOR_SCALE);

/** The seven notes of a key's scale (natural minor for minor). */
export function keyNotes(tonic: Pc, mode: Mode): Note[] {
  const scale = scaleSemis(mode);
  return scale.map((s, i) => shift({ ...tonic, octave: 4 }, i, s));
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export type Triad = 'M' | 'm' | 'd' | 'A' | '?';

/** The triad a chord quality is built on, from its third and fifth. */
export function triadOf(qualityId: string): Triad {
  const d = ` ${quality(qualityId).degrees} `;
  if (d.includes(' b3 ') && d.includes(' b5 ')) return 'd';
  if (d.includes(' b3 ')) return 'm';
  if (d.includes(' 3 ') && d.includes(' #5 ')) return 'A';
  if (d.includes(' 3 ')) return 'M';
  return '?';
}

/** The triad on each degree of a key. */
export function diatonicTriads(mode: Mode): Triad[] {
  const scale = scaleSemis(mode);
  return scale.map((_, i) => {
    const third = (scale[(i + 2) % 7]! - scale[i]! + 12) % 12;
    const fifth = (scale[(i + 4) % 7]! - scale[i]! + 12) % 12;
    if (third === 4 && fifth === 7) return 'M';
    if (third === 3 && fifth === 7) return 'm';
    if (third === 3 && fifth === 6) return 'd';
    if (third === 4 && fifth === 8) return 'A';
    return '?';
  });
}

const SEVENTH_SUFFIX: Record<string, string> = {
  dominant7: '7',
  major7: 'maj7',
  minor7: '7',
  minorMajor7: 'maj7',
  halfDiminished7: 'ø7',
  diminished7: '°7',
  augmented7: '+7',
  dominant7flat5: '7♭5',
  major6: '6',
  minor6: '6',
  dominant9: '9',
  major9: 'maj9',
  minor9: '9',
  dominant7flat9: '7♭9',
  dominant7sharp9: '7♯9',
  dominant11: '11',
  minor11: '11',
  dominant13: '13',
  major13: 'maj13',
  add9: 'add9',
  sus2: 'sus2',
  sus4: 'sus4',
  dominant7sus4: '7sus4',
};

/** Roman numeral text for a degree, triad, and chord quality: "V7", "ii°6", "viiø6/5". */
export function numeralText(generic: number, alt: number, q: string, inversion: number): string {
  const triad = triadOf(q);
  const upper = triad === 'M' || triad === 'A' || triad === '?';
  const letters = upper ? ROMAN[generic]! : ROMAN[generic]!.toLowerCase();
  const prefix = alt === 0 ? '' : (alt > 0 ? SHARP : FLAT).repeat(Math.abs(alt));
  const chord = quality(q);
  const sevenths = chord.stack >= 4 && !['major6', 'minor6'].includes(q);
  let suffix: string;
  if (inversion > 0 && chord.stack <= 4) {
    suffix = figuredBass(chord, inversion).replace('5/3', '').replace('6/3', '6');
    if (triad === 'd' && !sevenths) suffix = `°${suffix}`;
    else if (q === 'halfDiminished7') suffix = `ø${suffix}`;
    else if (q === 'diminished7') suffix = `°${suffix}`;
    else if (triad === 'A') suffix = `+${suffix}`;
    else if (q === 'major7' || q === 'minorMajor7') suffix = `maj${suffix}`;
  } else if (SEVENTH_SUFFIX[q]) {
    suffix = SEVENTH_SUFFIX[q]!;
  } else if (triad === 'd') suffix = '°';
  else if (triad === 'A') suffix = '+';
  else suffix = '';
  return `${prefix}${letters}${suffix}`;
}

export type RomanKind = 'diatonic' | 'secondary' | 'borrowed' | 'neapolitan' | 'augmentedSixth' | 'chromatic';

export interface Roman {
  kind: RomanKind;
  numeral: string;
  /** For secondary chords, the chord being tonicized; for augmented sixths, which kind. */
  detail: string;
  /** Which chord the symbol is, for display. */
  symbol: string;
  inversion: number;
  /** Semitones from the tonic to the root. */
  rootSemis: number;
}

const augmentedSixth = (rel: Note[], tonic: Note): string | null => {
  const has = (letters: number, semis: number): boolean =>
    rel.some((n) => {
      const l = (((n.step - tonic.step) % 7) + 7) % 7;
      const s = (pitchClass(n) - pitchClass(tonic) + 12) % 12;
      return l === letters && s === semis;
    });
  if (!has(5, 8) || !has(3, 6) || !has(0, 0)) return null;
  const extra = rel.filter((n) => {
    const l = (((n.step - tonic.step) % 7) + 7) % 7;
    const s = (pitchClass(n) - pitchClass(tonic) + 12) % 12;
    return !((l === 5 && s === 8) || (l === 3 && s === 6) || (l === 0 && s === 0));
  });
  const distinct = new Set(extra.map((n) => (pitchClass(n) - pitchClass(tonic) + 12) % 12));
  if (distinct.size === 0) return 'italian';
  if (distinct.size === 1 && distinct.has(2) && extra.every((n) => (((n.step - tonic.step) % 7) + 7) % 7 === 1)) {
    return 'french';
  }
  if (distinct.size === 1 && distinct.has(3) && extra.every((n) => (((n.step - tonic.step) % 7) + 7) % 7 === 2)) {
    return 'german';
  }
  return null;
};

/** The Roman numeral for a chord given as spelled notes, the lowest first, in a key. Null when the notes make no
 * chord and no augmented sixth. */
export function analyze(tonicPc: Pc, mode: Mode, notes: readonly Note[]): Roman | null {
  const tonic: Note = { ...tonicPc, octave: 4 };
  const tonicPcNum = pitchClass(tonic);
  const aug = augmentedSixth([...notes], tonic);
  if (aug) {
    const bassPc = (pitchClass(notes[0]!) - tonicPcNum + 12) % 12;
    return {
      kind: 'augmentedSixth',
      numeral: aug === 'italian' ? 'It+6' : aug === 'french' ? 'Fr+6' : 'Ger+6',
      detail: aug,
      symbol: notes.map((n) => pitchClassName(n)).join(' '),
      inversion: 0,
      rootSemis: bassPc,
    };
  }
  const named: ChordMatch | undefined = nameChord([...notes])[0];
  if (!named) return null;
  const rootPc = (pitchClass(named.root) - tonicPcNum + 12) % 12;
  const generic = (((named.root.step - tonic.step) % 7) + 7) % 7;
  const scale = scaleSemis(mode);
  let alt = rootPc - scale[generic]!;
  if (alt > 6) alt -= 12;
  if (alt < -6) alt += 12;
  const triad = triadOf(named.quality.id);
  const base: Omit<Roman, 'kind' | 'numeral' | 'detail'> = {
    symbol: named.symbol,
    inversion: named.inversion,
    rootSemis: rootPc,
  };
  const make = (kind: RomanKind, numeral: string, detail = ''): Roman => ({ kind, numeral, detail, ...base });
  const triads = diatonicTriads(mode);
  // Diatonic, allowing the raised leading tone and the major dominant of a minor key.
  let diatonicAlt = alt;
  if (mode === 'minor' && generic === 6 && alt === 1 && (triad === 'd' || triad === 'M')) diatonicAlt = 0;
  const fit =
    diatonicAlt === 0 &&
    (triads[generic] === triad ||
      (mode === 'minor' && generic === 4 && triad === 'M') ||
      (mode === 'minor' && generic === 6 && alt === 1 && triad === 'd'));
  if (fit) {
    const shownAlt = mode === 'minor' && generic === 6 && alt === 1 ? 0 : alt;
    return make('diatonic', numeralText(generic, shownAlt, named.quality.id, named.inversion));
  }
  // The Neapolitan: a major triad on the flat second degree.
  if (generic === 1 && alt === -1 && triad === 'M' && named.quality.stack === 3) {
    return make('neapolitan', named.inversion === 1 ? 'N6' : 'N', named.inversion === 1 ? 'first' : 'root');
  }
  // Secondary dominants and leading-tone chords: a dominant-type chord whose target is a diatonic chord.
  const isDominantType =
    (triad === 'M' && ['major', 'dominant7', 'dominant9', 'dominant7flat9', 'dominant13'].includes(named.quality.id)) ||
    named.quality.id === 'dominant7sharp9';
  const isLeadingType = triad === 'd';
  if (isDominantType || isLeadingType) {
    const targetPc = (rootPc + (isDominantType ? 5 : 1)) % 12;
    const k = scale.findIndex((s) => s === targetPc);
    if (k > 0 && triads[k] !== 'd') {
      const lead = numeralText(isDominantType ? 4 : 6, 0, named.quality.id, named.inversion);
      const targetNumeral = numeralText(k, 0, triads[k] === 'm' ? 'minor' : 'major', 0);
      return make('secondary', `${lead}/${targetNumeral}`, targetNumeral);
    }
  }
  // Borrowed from the parallel key.
  const other: Mode = mode === 'major' ? 'minor' : 'major';
  const otherScale = scaleSemis(other);
  const otherTriads = diatonicTriads(other);
  const bi = otherScale.findIndex((s) => s === rootPc);
  if (bi >= 0 && otherTriads[bi] === triad && bi === generic) {
    return make('borrowed', numeralText(generic, alt, named.quality.id, named.inversion), other);
  }
  return make('chromatic', numeralText(generic, alt, named.quality.id, named.inversion));
}

/** The seven diatonic triads of a key as chord symbols with Roman numerals. */
export function diatonicChords(tonic: Pc, mode: Mode): { numeral: string; symbol: string; notes: Note[] }[] {
  const scale = keyNotes(tonic, mode);
  const triads = diatonicTriads(mode);
  return scale.map((root, i) => {
    const id = triads[i] === 'M' ? 'major' : triads[i] === 'm' ? 'minor' : triads[i] === 'd' ? 'diminished' : 'augmented';
    const q = quality(id);
    return {
      numeral: numeralText(i, 0, id, 0),
      symbol: chordSymbol(root, q),
      notes: spellChord(root, q),
    };
  });
}
