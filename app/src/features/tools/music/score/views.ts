// What a tune looks like in other notations, worked out from the notes: numbered (jianpu) notation, Hindustani sargam,
// and guitar tablature; and the transposed tune. Everything is computed from the parsed notes.
import { fifthsOf } from '../theory/keys';
import { MAJOR, between, diatonic, midiOf, noteName, parsePitchClass, shift, transposeNote } from '../theory/notes';
import type { Note } from '../theory/notes';
import { instrument, writtenNote } from '../theory/practice';
import { AbcError, keyAlterations, parseKey } from './abc';
import type { Item, Key, NoteItem, Tune, Voice } from './abc';
import type { Interval } from '../theory/notes';

const ABOVE = '\u0307';
const BELOW = '\u0323';
const UNDER = '\u0332';
const DOUBLE_UNDER = '\u0333';
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** The tonic of the major key with a given signature, which numbered notation counts from. */
export function majorTonic(fifths: number): Pick<Note, 'step' | 'alt'> {
  const step = (((fifths * 4) % 7) + 7) % 7;
  let alt = mod12(fifths * 7 - MAJOR[step]!);
  if (alt > 6) alt -= 12;
  return { step, alt };
}

interface Marks {
  /** Number of octaves above (+) or below (−) the one that starts on the tonic in octave 4. */
  octave: number;
}

const octaveOf = (note: Note, tonic: Pick<Note, 'step' | 'alt'>): Marks => ({
  octave: Math.floor((diatonic(note) - diatonic({ ...tonic, octave: 4 })) / 7),
});

/** The accidental in front of a degree when the note is not in the key's own scale. */
function chromatic(note: Note, keyAlt: readonly number[]): string {
  const d = note.alt - (keyAlt[note.step] ?? 0);
  return d === 0 ? '' : d > 0 ? '♯'.repeat(d) : '♭'.repeat(-d);
}

function dots(octave: number): string {
  return octave > 0 ? ABOVE.repeat(octave) : octave < 0 ? BELOW.repeat(-octave) : '';
}

/** The length of a note or rest in numbered notation: dashes for longer notes, underlines for shorter, a dot for 1.5. */
function lengthMarks(beats: number): { under: number; dashes: number; dot: boolean } {
  if (beats >= 1) {
    const whole = Math.floor(beats + 1e-9);
    return { under: 0, dashes: whole - 1, dot: Math.abs(beats - whole - 0.5) < 1e-9 };
  }
  const p = 2 ** Math.floor(Math.log2(beats) + 1e-9);
  return { under: -Math.log2(p), dashes: 0, dot: Math.abs(beats / p - 1.5) < 1e-9 };
}

export interface NumberedLine {
  /** The degrees with octave dots and bar lines only. */
  plain: string;
  /** The same with lengths: underlines, dashes, and dots. */
  timed: string;
}

export function jianpu(voice: Voice, key: Key): NumberedLine {
  const tonic = majorTonic(key.fifths);
  const keyAlt = keyAlterations(key.fifths);
  const plain: string[] = [];
  const timed: string[] = [];
  for (const item of voice.items) {
    if (item.kind === 'bar') {
      plain.push('|');
      timed.push('|');
      continue;
    }
    const beats = item.dur * 4;
    const marks = lengthMarks(beats);
    let digit: string;
    if (item.kind === 'rest') digit = '0';
    else {
      const note = item.pitches[0]!;
      const degree = ((note.step - tonic.step + 7) % 7) + 1;
      digit = `${chromatic(note, keyAlt)}${degree}${dots(octaveOf(note, tonic).octave)}`;
    }
    plain.push(digit);
    const under = marks.under === 0 ? '' : marks.under === 1 ? UNDER : DOUBLE_UNDER;
    timed.push(`${digit}${under}${marks.dot ? '·' : ''}${' -'.repeat(marks.dashes)}`);
  }
  return { plain: plain.join(' '), timed: timed.join(' ') };
}

const SARGAM = ['S', 'r', 'R', 'g', 'G', 'M', 'M♯', 'P', 'd', 'D', 'n', 'N'] as const;

export function sargam(voice: Voice, key: Key): string {
  const tonic: Note = { ...key.tonic, octave: 4 };
  const out: string[] = [];
  for (const item of voice.items) {
    if (item.kind === 'bar') out.push('|');
    else if (item.kind === 'rest') out.push('–');
    else {
      const note = item.pitches[0]!;
      const offset = midiOf(note) - midiOf(tonic);
      const octave = Math.floor(offset / 12);
      const name = SARGAM[mod12(offset)]!;
      out.push(octave > 0 ? `${name}${"'".repeat(octave)}` : octave < 0 ? `${name}${','.repeat(-octave)}` : name);
    }
  }
  return out.join(' ');
}

// --- tablature --------------------------------------------------------------------------------------------------------------

/** Open strings of a standard-tuned guitar, string 6 (low E2) first. */
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64] as const;
export const MAX_FRET = 19;
/** A hand holds about four frets without moving. */
export const HAND_SPAN = 4;

export interface TabNote {
  string: number;
  fret: number;
}

/** Strings and frets for a chord or note: the assignment with the lowest frets, open strings preferred, that keeps the
 * hand within its span of the previous fretted note. */
export function tabFor(
  midis: readonly number[],
  position: number | null,
): { notes: TabNote[]; position: number | null } | null {
  const sorted = [...midis].sort((a, b) => a - b);
  let best: { notes: TabNote[]; cost: number } | null = null;
  const walk = (i: number, used: number, chosen: TabNote[]): void => {
    if (i === sorted.length) {
      const frets = chosen.filter((n) => n.fret > 0).map((n) => n.fret);
      const spread = frets.length > 0 ? Math.max(...frets) - Math.min(...frets) : 0;
      const far = position !== null && frets.some((f) => Math.abs(f - position) > HAND_SPAN - 1) ? 100 : 0;
      const cost = frets.reduce((a, b) => a + b, 0) + (spread > HAND_SPAN - 1 ? 100 : 0) + far;
      if (best === null || cost < best.cost) best = { notes: chosen, cost };
      return;
    }
    OPEN_STRINGS.forEach((open, index) => {
      const fret = sorted[i]! - open;
      if (fret < 0 || fret > MAX_FRET || (used & (1 << index)) !== 0) return;
      walk(i + 1, used | (1 << index), [...chosen, { string: 6 - index, fret }]);
    });
  };
  walk(0, 0, []);
  if (best === null) return null;
  const found: { notes: TabNote[]; cost: number } = best;
  const fretted = found.notes.filter((n) => n.fret > 0);
  return { notes: found.notes, position: fretted.length > 0 ? fretted[fretted.length - 1]!.fret : position };
}

export interface TabResult {
  /** "6:0 5:0" style text, one group per note. */
  text: string;
  /** Six text lines, high string first. */
  staff: string;
  /** The first note that cannot be played on a guitar, if any. */
  bad?: Note;
}

export function tablature(voice: Voice): TabResult {
  const groups: string[] = [];
  const columns: string[][] = [[], [], [], [], [], []];
  let hand: number | null = null;
  for (const item of voice.items) {
    if (item.kind === 'bar') {
      groups.push('|');
      columns.forEach((c) => c.push('|'));
      continue;
    }
    if (item.kind === 'rest') {
      groups.push('–');
      columns.forEach((c) => c.push('-'));
      continue;
    }
    const found = tabFor(item.pitches.map(midiOf), hand);
    if (!found) {
      const bad = item.pitches.find((p) => midiOf(p) < 40 || midiOf(p) > 64 + MAX_FRET) ?? item.pitches[0]!;
      return { text: groups.join(' '), staff: '', bad };
    }
    hand = found.position;
    groups.push(found.notes.map((n) => `${n.string}:${n.fret}`).join('+'));
    columns.forEach((c, row) => {
      const note = found.notes.find((n) => n.string === row + 1);
      c.push(note ? String(note.fret) : '-');
    });
  }
  const names = ['e', 'B', 'G', 'D', 'A', 'E'];
  const staff = columns
    .map((cells, row) => {
      const width = Math.max(...cells.map((c) => c.length));
      return `${names[row]}|${cells.map((c) => c.padEnd(width, '-')).join('--')}-|`;
    })
    .join('\n');
  return { text: groups.join(' '), staff };
}

// --- transposition ------------------------------------------------------------------------------------------------------------

const modeSuffix = (mode: Key['mode']): string => (mode === 'major' ? '' : mode === 'minor' ? 'm' : mode.slice(0, 3));

function keyFrom(tonic: Pick<Note, 'step' | 'alt'>, mode: Key['mode']): Key {
  if (Math.abs(tonic.alt) > 1) throw new AbcError('key', 'far');
  const text = `${'CDEFGAB'[tonic.step]}${tonic.alt > 0 ? '#' : tonic.alt < 0 ? 'b' : ''}${modeSuffix(mode)}`;
  const key = parseKey(text);
  if (!key || Math.abs(key.fifths) > 7) throw new AbcError('key', 'far');
  return key;
}

function mapNotes(tune: Tune, key: Key, move: (n: Note) => Note): Tune {
  const voices = tune.voices.map((voice) => ({
    ...voice,
    items: voice.items.map((item): Item => {
      if (item.kind !== 'note') return item;
      return {
        ...item,
        pitches: item.pitches.map((p) => {
          const moved = move(p);
          if (Math.abs(moved.alt) > 2) throw new AbcError('key', 'far');
          return { ...moved, written: '' };
        }),
      } satisfies NoteItem;
    }),
  }));
  return { ...tune, key, voices };
}

export function transposeBy(tune: Tune, interval: Interval, down: boolean): Tune {
  const tonic = transposeNote({ ...tune.key.tonic, octave: 4 }, interval, down);
  return mapNotes(tune, keyFrom(tonic, tune.key.mode), (n) => transposeNote(n, interval, down));
}

/** The nearest way to the key of the given tonic (up or down, within a tritone) with the same mode. */
export function transposeToKey(
  tune: Tune,
  tonicText: string,
): { tune: Tune; interval: Interval; down: boolean } | null {
  const target = parsePitchClass(tonicText);
  if (!target) return null;
  const from: Note = { ...tune.key.tonic, octave: 4 };
  let best: { interval: Interval; down: boolean } | null = null;
  for (const octave of [3, 4]) {
    const { interval, descending } = between(from, { ...target, octave });
    if (best === null || interval.semitones < best.interval.semitones) best = { interval, down: descending };
  }
  if (!best) return null;
  return { tune: transposeBy(tune, best.interval, best.down), ...best };
}

/** The part for a transposing instrument: every sounding note moved to the note to write, and the key moved with it. */
export function forInstrument(tune: Tune, id: string): Tune {
  const inst = instrument(id);
  const tonic = writtenNote({ ...tune.key.tonic, octave: 4 }, inst);
  return mapNotes(tune, keyFrom(tonic, tune.key.mode), (n) => writtenNote(n, inst));
}

export const firstNoteName = (voice: Voice): string => {
  const item = voice.items.find((i): i is NoteItem => i.kind === 'note');
  return item ? noteName(item.pitches[0]!) : '';
};

export { shift, fifthsOf };
