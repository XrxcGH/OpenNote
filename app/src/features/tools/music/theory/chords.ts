// Chords: spell a symbol such as Cmaj7 or F#m7b5, name the chord a set of notes makes, and find an inversion's
// figured bass. Chord tones are written as degrees above the root so every chord is spelled correctly.
import { degreeNote, parseDegree, parsePitchClass, pitchClass, pitchClassName } from './notes';
import type { Note } from './notes';

export interface ChordQuality {
  id: string;
  /** What is written after the root, first the preferred way. */
  symbols: readonly string[];
  degrees: string;
  /** Number of chord tones that make up the stacked thirds (3 for a triad, 4 for a seventh chord). */
  stack: number;
}

export const QUALITIES: readonly ChordQuality[] = [
  { id: 'major', symbols: ['', 'M', 'maj'], degrees: '1 3 5', stack: 3 },
  { id: 'minor', symbols: ['m', 'min', '-'], degrees: '1 b3 5', stack: 3 },
  { id: 'diminished', symbols: ['dim', '°', 'o'], degrees: '1 b3 b5', stack: 3 },
  { id: 'augmented', symbols: ['aug', '+'], degrees: '1 3 #5', stack: 3 },
  { id: 'sus2', symbols: ['sus2'], degrees: '1 2 5', stack: 3 },
  { id: 'sus4', symbols: ['sus4', 'sus'], degrees: '1 4 5', stack: 3 },
  { id: 'power', symbols: ['5'], degrees: '1 5', stack: 2 },
  { id: 'major6', symbols: ['6'], degrees: '1 3 5 6', stack: 4 },
  { id: 'minor6', symbols: ['m6', 'min6', '-6'], degrees: '1 b3 5 6', stack: 4 },
  { id: 'dominant7', symbols: ['7'], degrees: '1 3 5 b7', stack: 4 },
  { id: 'major7', symbols: ['maj7', 'M7', 'Δ7', 'Δ'], degrees: '1 3 5 7', stack: 4 },
  { id: 'minor7', symbols: ['m7', 'min7', '-7'], degrees: '1 b3 5 b7', stack: 4 },
  { id: 'minorMajor7', symbols: ['mMaj7', 'm(maj7)', 'mM7', '-M7'], degrees: '1 b3 5 7', stack: 4 },
  { id: 'halfDiminished7', symbols: ['m7b5', 'ø7', 'ø', 'min7b5'], degrees: '1 b3 b5 b7', stack: 4 },
  { id: 'diminished7', symbols: ['dim7', '°7', 'o7'], degrees: '1 b3 b5 bb7', stack: 4 },
  { id: 'augmented7', symbols: ['7#5', 'aug7', '+7'], degrees: '1 3 #5 b7', stack: 4 },
  { id: 'dominant7flat5', symbols: ['7b5'], degrees: '1 3 b5 b7', stack: 4 },
  { id: 'dominant7sus4', symbols: ['7sus4', '7sus'], degrees: '1 4 5 b7', stack: 4 },
  { id: 'add9', symbols: ['add9', '(add9)'], degrees: '1 3 5 9', stack: 4 },
  { id: 'dominant9', symbols: ['9'], degrees: '1 3 5 b7 9', stack: 5 },
  { id: 'major9', symbols: ['maj9', 'M9', 'Δ9'], degrees: '1 3 5 7 9', stack: 5 },
  { id: 'minor9', symbols: ['m9', 'min9', '-9'], degrees: '1 b3 5 b7 9', stack: 5 },
  { id: 'dominant7flat9', symbols: ['7b9'], degrees: '1 3 5 b7 b9', stack: 5 },
  { id: 'dominant7sharp9', symbols: ['7#9'], degrees: '1 3 5 b7 #9', stack: 5 },
  { id: 'dominant11', symbols: ['11'], degrees: '1 3 5 b7 9 11', stack: 6 },
  { id: 'minor11', symbols: ['m11', 'min11', '-11'], degrees: '1 b3 5 b7 9 11', stack: 6 },
  { id: 'dominant13', symbols: ['13'], degrees: '1 3 5 b7 9 13', stack: 7 },
  { id: 'major13', symbols: ['maj13', 'M13'], degrees: '1 3 5 7 9 13', stack: 7 },
];

export const quality = (id: string): ChordQuality => QUALITIES.find((q) => q.id === id) ?? QUALITIES[0]!;

export interface Chord {
  root: Note;
  quality: ChordQuality;
  /** The bass note when it is not the root (a slash chord), else null. */
  bass: Pick<Note, 'step' | 'alt'> | null;
  symbol: string;
  /** The chord tones from the root up, each placed above the root's octave. */
  notes: Note[];
}

const SYMBOL_LOOKUP: [string, ChordQuality][] = QUALITIES.flatMap((q) =>
  q.symbols.map((s) => [s, q] as [string, ChordQuality]),
).sort((a, b) => b[0].length - a[0].length);

/** The notes of a chord quality above a root. */
export function spellChord(root: Note, q: ChordQuality): Note[] {
  return q.degrees.split(' ').map((token) => degreeNote(root, token));
}

/** The symbol written for a root and quality, such as "Cmaj7" or "E♭m". */
export function chordSymbol(
  root: Pick<Note, 'step' | 'alt'>,
  q: ChordQuality,
  bass?: Pick<Note, 'step' | 'alt'> | null,
) {
  const slash = bass && (bass.step !== root.step || bass.alt !== root.alt) ? `/${pitchClassName(bass)}` : '';
  return `${pitchClassName(root)}${q.symbols[0]!}${slash}`;
}

/** Reads a chord symbol such as "Cmaj7", "F#m7b5", "Bb7", or "C/E"; null when it is not one. */
export function parseChord(text: string, octave = 4): Chord | null {
  const [main, bassText] = text.trim().split('/');
  if (!main) return null;
  const m = /^([A-Ga-g])([#♯b♭x𝄪]*)(.*)$/u.exec(main);
  if (!m) return null;
  const tail = m[3]!;
  // "Bb" is B flat; a "b" that starts the quality ("Bb5") is read as the flat sign first.
  const root = parsePitchClass(m[1]! + m[2]!);
  if (!root) return null;
  const found = SYMBOL_LOOKUP.find(([s]) => s === tail.trim());
  if (!found) return null;
  const rootNote: Note = { ...root, octave };
  let bass: Chord['bass'] = null;
  if (bassText !== undefined) {
    const b = parsePitchClass(bassText);
    if (!b) return null;
    bass = b;
  }
  return {
    root: rootNote,
    quality: found[1],
    bass,
    symbol: chordSymbol(root, found[1], bass),
    notes: spellChord(rootNote, found[1]),
  };
}

// --- naming a set of notes ----------------------------------------------------------------------------------------------

export interface ChordMatch {
  root: Pick<Note, 'step' | 'alt'>;
  quality: ChordQuality;
  bass: Pick<Note, 'step' | 'alt'>;
  symbol: string;
  /** 0 for root position, 1 for first inversion, and so on, counted in the chord's stack of thirds. */
  inversion: number;
}

const toneSet = (q: ChordQuality, root: number): string =>
  [...new Set(q.degrees.split(' ').map((d) => (pitchSemis(d) + root) % 12))].sort((a, b) => a - b).join(',');

const pitchSemis = (token: string): number => ((parseDegree(token)!.semis % 12) + 12) % 12;

/** Which chords the given notes could be, the lowest note first as the bass. Several answers are possible. */
export function nameChord(notes: readonly Note[]): ChordMatch[] {
  if (notes.length < 2) return [];
  const pcs = [...new Set(notes.map((n) => pitchClass(n)))];
  const bass = notes[0]!;
  const out: ChordMatch[] = [];
  for (const candidate of notes) {
    const rootPc = pitchClass(candidate);
    const rel = pcs
      .map((p) => (p - rootPc + 12) % 12)
      .sort((a, b) => a - b)
      .join(',');
    for (const q of QUALITIES) {
      if (toneSet(q, 0) !== rel) continue;
      const stackNotes = q.degrees.split(' ').slice(0, q.stack);
      const bassRel = (pitchClass(bass) - rootPc + 12) % 12;
      const inversion = Math.max(
        0,
        stackNotes.findIndex((d) => pitchSemis(d) === bassRel),
      );
      if (!out.some((o) => o.quality.id === q.id && o.root.step === candidate.step && o.root.alt === candidate.alt))
        out.push({
          root: { step: candidate.step, alt: candidate.alt },
          quality: q,
          bass: { step: bass.step, alt: bass.alt },
          symbol: chordSymbol(candidate, q, bass),
          inversion,
        });
    }
  }
  // Prefer the answer whose root is the bass, then fewer unusual qualities.
  return out.sort((a, b) => Number(a.inversion !== 0) - Number(b.inversion !== 0));
}

/** The figures written under the bass for a chord in an inversion: 5/3, 6/3, 6/4 for triads; 7, 6/5, 4/3, 4/2 for
 * seventh chords. */
export function figuredBass(q: ChordQuality, inversion: number): string {
  if (q.stack === 3) return ['5/3', '6/3', '6/4'][inversion] ?? '5/3';
  if (q.stack >= 4) return ['7', '6/5', '4/3', '4/2'][inversion] ?? '7';
  return '';
}

/** A short word for the inversion: root position, first inversion, and so on. */
export const INVERSION_NAMES = ['root', 'first', 'second', 'third'] as const;
