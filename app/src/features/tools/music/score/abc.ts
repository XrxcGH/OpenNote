// A small reader and writer for ABC notation (abcnotation.com, an open standard): headers, notes with accidentals,
// octaves and lengths, rests, chords, ties, bar lines, tuplets, and several voices. It covers what a student types in a
// notes page; decorations, grace notes, and lyrics are skipped. Nothing the user writes is ever evaluated.
import { fifthsOf, signature } from '../theory/keys';
import type { Mode } from '../theory/keys';
import { MAJOR, accidental, midiOf, parsePitchClass } from '../theory/notes';
import type { Note } from '../theory/notes';

export interface Pitch extends Note {
  /** The accidental the music writes next to the note: '^', '^^', '_', '__', '=', or '' when it follows the key. */
  written: string;
}

export interface NoteItem {
  kind: 'note';
  pitches: Pitch[];
  /** Length as a fraction of a whole note. */
  dur: number;
  tied: boolean;
}
export interface RestItem {
  kind: 'rest';
  dur: number;
}
export interface BarItem {
  kind: 'bar';
  style: string;
}
export type Item = NoteItem | RestItem | BarItem;

export interface Voice {
  id: string;
  items: Item[];
}

export interface Meter {
  num: number;
  den: number;
}

export interface Key {
  tonic: { step: number; alt: number };
  mode: Mode | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian';
  /** Sharps (positive) or flats (negative) in the signature. */
  fifths: number;
  text: string;
}

export interface Tune {
  title: string;
  meter: Meter;
  unit: number;
  bpm: number;
  key: Key;
  voices: Voice[];
}

export class AbcError extends Error {
  constructor(
    readonly code: 'empty' | 'noKey' | 'char' | 'meter' | 'length' | 'key' | 'chord' | 'tuplet',
    readonly detail: string = '',
    readonly line = 0,
  ) {
    super(code);
  }
}

const MODE_SHIFT: Record<string, { shift: number; name: Key['mode'] }> = {
  '': { shift: 0, name: 'major' },
  maj: { shift: 0, name: 'major' },
  major: { shift: 0, name: 'major' },
  ion: { shift: 0, name: 'major' },
  m: { shift: -3, name: 'minor' },
  min: { shift: -3, name: 'minor' },
  minor: { shift: -3, name: 'minor' },
  aeo: { shift: -3, name: 'minor' },
  dor: { shift: -2, name: 'dorian' },
  phr: { shift: -4, name: 'phrygian' },
  lyd: { shift: 1, name: 'lydian' },
  mix: { shift: -1, name: 'mixolydian' },
  loc: { shift: -5, name: 'locrian' },
};

export function parseKey(text: string): Key | null {
  const m = /^\s*([A-Ga-g])\s*([#b]?)\s*([A-Za-z]*)/.exec(text);
  if (!m) return null;
  const tonic = parsePitchClass(`${m[1]!.toUpperCase()}${m[2]}`);
  if (!tonic) return null;
  const word = m[3]!.toLowerCase();
  const found = MODE_SHIFT[word] ?? MODE_SHIFT[word.slice(0, 3)];
  if (!found) return null;
  const fifths = fifthsOf(tonic, 'major') + found.shift;
  return {
    tonic,
    mode: found.name,
    fifths,
    text: `${m[1]!.toUpperCase()}${m[2]}${found.name === 'major' ? '' : found.name === 'minor' ? 'm' : found.name.slice(0, 3)}`,
  };
}

/** The alteration the key signature gives each letter (0 = C), as -1, 0, or 1 (or 2 past seven accidentals). */
export function keyAlterations(fifths: number): number[] {
  const alt = [0, 0, 0, 0, 0, 0, 0];
  for (const mark of signature(fifths)) {
    const step = 'CDEFGAB'.indexOf(mark[0]!);
    alt[step] = (alt[step] ?? 0) + (fifths > 0 ? 1 : -1);
  }
  return alt;
}

const parseFraction = (text: string): number | null => {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
};

/** The multiplier an ABC length suffix means: "", "2", "/", "/2", "3/2", "//". */
function lengthFactor(suffix: string): number | null {
  if (suffix === '') return 1;
  const m = /^(\d*)(\/*)(\d*)$/.exec(suffix);
  if (!m) return null;
  const num = m[1] === '' ? 1 : Number(m[1]);
  if (m[2] === '') return num;
  const den = m[3] !== '' ? Number(m[3]) : 2 ** m[2]!.length;
  return den > 0 ? num / den : null;
}

const BAR = /^(\|\]|\[\||\|\||:\||\|:|::|\|)/;
const NOTE = /^(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)/;

export function parseAbc(source: string): Tune {
  if (source.trim() === '') throw new AbcError('empty');
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  let meter: Meter = { num: 4, den: 4 };
  let unit: number | null = null;
  let bpm = 120;
  let key: Key | null = null;
  const voices = new Map<string, Voice>();
  let current: Voice | null = null;
  let headerDone = false;
  const voiceFor = (id: string): Voice => {
    let v = voices.get(id);
    if (!v) {
      v = { id, items: [] };
      voices.set(id, v);
    }
    return v;
  };
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.replace(/%.*$/, '').trim();
    if (line === '') return;
    const field = /^([A-Za-z]):\s*(.*)$/.exec(line);
    if (field) {
      const [, f, rest] = field as unknown as [string, string, string];
      switch (f) {
        case 'T':
          if (title === '') title = rest.trim();
          return;
        case 'M': {
          if (rest.trim() === 'C') meter = { num: 4, den: 4 };
          else if (rest.trim() === 'C|') meter = { num: 2, den: 2 };
          else {
            const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(rest.trim());
            if (!frac || Number(frac[1]) < 1 || Number(frac[2]) < 1) throw new AbcError('meter', rest.trim(), lineNo);
            meter = { num: Number(frac[1]), den: Number(frac[2]) };
          }
          return;
        }
        case 'L': {
          const value = parseFraction(rest);
          if (value === null || value <= 0) throw new AbcError('length', rest.trim(), lineNo);
          unit = value;
          return;
        }
        case 'Q': {
          const m = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+)\s*$/.exec(rest.trim());
          if (m) bpm = m[1] ? Number(m[3]) * (Number(m[1]) / Number(m[2])) * 4 : Number(m[3]);
          return;
        }
        case 'K': {
          const parsed = parseKey(rest);
          if (!parsed) throw new AbcError('key', rest.trim(), lineNo);
          key = parsed;
          headerDone = true;
          return;
        }
        case 'V':
          current = voiceFor(rest.trim().split(/\s+/)[0] || '1');
          return;
        case 'w':
        case 'W':
          return;
        default:
          return;
      }
    }
    if (!headerDone) throw new AbcError('noKey', '', lineNo);
    current ??= voiceFor('1');
    readBody(line, lineNo, current, key!, meter, unit);
  });
  if (!key) throw new AbcError('noKey');
  const all = [...voices.values()].filter((v) => v.items.some((i) => i.kind !== 'bar'));
  if (all.length === 0) throw new AbcError('empty');
  const chosenUnit = unit ?? (meter.num / meter.den < 0.75 ? 1 / 16 : 1 / 8);
  return { title, meter, unit: chosenUnit, bpm, key, voices: all };
}

interface Reader {
  rest: string;
  lineNo: number;
  voice: Voice;
  unit: number;
  keyAlt: number[];
  barAcc: Map<string, number>;
  tuplet: { left: number; factor: number } | null;
}

const LENGTH = /^(\d*\/*\d*)/;

const take = (r: Reader, count: number): void => {
  r.rest = r.rest.slice(count);
};

/** Reads the length suffix at the front of the rest, as a multiple of the unit note length. */
function takeLength(r: Reader): number {
  const suffix = LENGTH.exec(r.rest)![1]!;
  take(r, suffix.length);
  return lengthFactor(suffix) ?? 1;
}

function push(r: Reader, item: Item): void {
  if (item.kind !== 'bar' && r.tuplet) {
    item.dur *= r.tuplet.factor;
    if (--r.tuplet.left === 0) r.tuplet = null;
  }
  r.voice.items.push(item);
}

function readPitch(r: Reader, m: RegExpExecArray): Pitch {
  const acc = m[1] ?? '';
  const letter = m[2]!;
  const step = 'CDEFGAB'.indexOf(letter.toUpperCase());
  const up = m[3]!.match(/'/g)?.length ?? 0;
  const down = m[3]!.match(/,/g)?.length ?? 0;
  const octave = (letter === letter.toLowerCase() ? 5 : 4) + up - down;
  const id = `${step}${octave}`;
  let alt: number;
  if (acc !== '') {
    alt = acc === '^^' ? 2 : acc === '^' ? 1 : acc === '__' ? -2 : acc === '_' ? -1 : 0;
    r.barAcc.set(id, alt);
  } else alt = r.barAcc.get(id) ?? r.keyAlt[step] ?? 0;
  return { step, alt, octave, written: acc };
}

/** A tuplet marker such as (3 or (3:2:3, which squeezes the next few notes. */
function readTuplet(r: Reader): void {
  const t = /^\((\d)(?::(\d*))?(?::(\d*))?/.exec(r.rest);
  if (!t) return take(r, 1);
  const p = Number(t[1]);
  if (p < 2) throw new AbcError('tuplet', t[0], r.lineNo);
  const q = t[2] ? Number(t[2]) : p === 2 || p === 4 || p === 8 ? 3 : 2;
  r.tuplet = { left: t[3] ? Number(t[3]) : p, factor: q / p };
  take(r, t[0].length);
}

/** A chord in square brackets with its length. Lengths inside the brackets multiply the one after. */
function readChord(r: Reader): void {
  const end = r.rest.indexOf(']');
  if (end < 0) throw new AbcError('chord', r.rest, r.lineNo);
  let inside = r.rest.slice(1, end);
  const pitches: Pitch[] = [];
  let inner = 1;
  while (inside.length > 0) {
    const m = NOTE.exec(inside);
    const len = LENGTH.exec(inside)![1]!;
    if (m) {
      pitches.push(readPitch(r, m));
      inside = inside.slice(m[0].length);
    } else if (len !== '' && pitches.length > 0) {
      inner = lengthFactor(len) ?? 1;
      inside = inside.slice(len.length);
    } else throw new AbcError('chord', inside, r.lineNo);
  }
  take(r, end + 1);
  push(r, { kind: 'note', pitches, dur: r.unit * takeLength(r) * inner, tied: false });
}

/** Something in square brackets: an inline field, a volta number, or a chord. */
function readBracket(r: Reader): void {
  const skip = /^\[[A-Za-z]:[^\]]*\]/.exec(r.rest) ?? /^\[\d[\d,-]*/.exec(r.rest);
  if (skip) take(r, skip[0].length);
  else readChord(r);
}

/** Skips text between a pair of marks, such as a chord symbol in quotes or a decoration between exclamation marks. */
function skipPair(r: Reader, close: string): void {
  const end = r.rest.indexOf(close, 1);
  take(r, end < 0 ? r.rest.length : end + 1);
}

function markTied(r: Reader): void {
  const last = [...r.voice.items].reverse().find((i) => i.kind === 'note');
  if (last?.kind === 'note') last.tied = true;
  take(r, 1);
}

const IGNORED = '.~HLMOPSTuv)\\';

/** Reads one thing from the front of the rest of the line. */
function step(r: Reader): void {
  const c = r.rest[0]!;
  const bar = BAR.exec(r.rest);
  const note = NOTE.exec(r.rest);
  if (/\s/.test(c) || IGNORED.includes(c)) take(r, 1);
  else if (bar) {
    push(r, { kind: 'bar', style: bar[1]! });
    r.barAcc.clear();
    take(r, bar[1]!.length);
  } else if (c === '"') skipPair(r, '"');
  else if (c === '!' || c === '+') skipPair(r, c);
  else if (c === '{') skipPair(r, '}');
  else if (c === '-') markTied(r);
  else if (c === '(') readTuplet(r);
  else if (c === '[') readBracket(r);
  else if (c === 'z' || c === 'x') {
    take(r, 1);
    push(r, { kind: 'rest', dur: r.unit * takeLength(r) });
  } else if (c === 'Z') r.rest = r.rest.slice(1).replace(/^\d*/, '');
  else if (note) {
    take(r, note[0].length);
    const pitch = readPitch(r, note);
    push(r, { kind: 'note', pitches: [pitch], dur: r.unit * takeLength(r), tied: false });
  } else if (c === ':' || c === ']') take(r, 1);
  else throw new AbcError('char', c, r.lineNo);
}

function readBody(text: string, lineNo: number, voice: Voice, key: Key, meter: Meter, unitSet: number | null): void {
  const unit = unitSet ?? (meter.num / meter.den < 0.75 ? 1 / 16 : 1 / 8);
  const r: Reader = {
    rest: text,
    lineNo,
    voice,
    unit,
    keyAlt: keyAlterations(key.fifths),
    barAcc: new Map(),
    tuplet: null,
  };
  while (r.rest.length > 0) step(r);
}

// --- measures, checking, playback --------------------------------------------------------------------------------------

export const barLength = (m: Meter): number => m.num / m.den;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

export interface BarCheck {
  voice: string;
  bar: number;
  length: number;
  expected: number;
}

/** Bars (not counting a short pickup first bar or a short last bar) whose length differs from the meter's. */
export function checkBars(tune: Tune): BarCheck[] {
  const issues: BarCheck[] = [];
  for (const voice of tune.voices) {
    const bars: number[] = [0];
    for (const item of voice.items) {
      if (item.kind === 'bar') {
        if (bars[bars.length - 1] !== 0) bars.push(0);
      } else bars[bars.length - 1]! += item.dur;
    }
    if (bars[bars.length - 1] === 0) bars.pop();
    const expected = barLength(tune.meter);
    bars.forEach((length, i) => {
      const edge = i === 0 || i === bars.length - 1;
      if (!near(length, expected) && !(edge && length < expected))
        issues.push({ voice: voice.id, bar: i + 1, length, expected });
    });
  }
  return issues;
}

export const countNotes = (voice: Voice): number => voice.items.filter((i) => i.kind === 'note').length;
export const countBars = (voice: Voice): number => {
  let bars = 0;
  let open = false;
  for (const item of voice.items) {
    if (item.kind === 'bar') {
      if (open) bars++;
      open = false;
    } else open = true;
  }
  return bars + (open ? 1 : 0);
};

export interface Timed {
  at: number;
  dur: number;
  midi: number[];
  rest: boolean;
}

/** Start and length in quarter-note beats of every sounding item, ties merged. */
export function timeline(voice: Voice): Timed[] {
  const out: Timed[] = [];
  let at = 0;
  let pendingTie: Timed | null = null;
  for (const item of voice.items) {
    if (item.kind === 'bar') continue;
    const beats = item.dur * 4;
    if (item.kind === 'rest') {
      out.push({ at, dur: beats, midi: [], rest: true });
      pendingTie = null;
    } else {
      const midi = item.pitches.map(midiOf);
      if (pendingTie && pendingTie.midi.join() === midi.join()) pendingTie.dur += beats;
      else {
        const t = { at, dur: beats, midi, rest: false };
        out.push(t);
        pendingTie = t;
      }
      if (!item.tied) pendingTie = null;
    }
    at += beats;
  }
  return out;
}

// --- writing ABC --------------------------------------------------------------------------------------------------------

function lengthText(units: number): string {
  if (near(units, 1)) return '';
  if (Number.isInteger(units)) return String(units);
  for (const den of [2, 4, 8, 16, 3, 6, 12]) {
    const num = units * den;
    if (near(num, Math.round(num))) {
      const n = Math.round(num);
      return n === 1 ? `/${den === 2 ? '' : den}` : `${n}/${den}`;
    }
  }
  return `*${units.toFixed(4)}`;
}

function pitchText(p: Note, keyAlt: readonly number[]): string {
  const wanted = keyAlt[p.step] ?? 0;
  const acc = p.alt === wanted ? '' : p.alt === 0 ? '=' : p.alt > 0 ? '^'.repeat(p.alt) : '_'.repeat(-p.alt);
  const letter = 'CDEFGAB'[p.step]!;
  if (p.octave >= 5) return `${acc}${letter.toLowerCase()}${"'".repeat(p.octave - 5)}`;
  return `${acc}${letter}${','.repeat(4 - p.octave)}`;
}

export const keyHeader = (key: Key): string => key.text;

/** Writes a tune back as ABC text. Accidentals are written against the key signature, repeated where a bar needs them. */
export function writeAbc(tune: Tune, key: Key = tune.key): string {
  const keyAlt = keyAlterations(key.fifths);
  const head = [
    `X:1`,
    tune.title ? `T:${tune.title}` : '',
    `M:${tune.meter.num}/${tune.meter.den}`,
    `L:1/${Math.round(1 / tune.unit)}`,
    `Q:1/4=${Math.round(tune.bpm)}`,
  ].filter(Boolean);
  const body: string[] = [];
  const multi = tune.voices.length > 1;
  for (const voice of tune.voices) {
    if (multi) body.push(`V:${voice.id}`);
    let line = '';
    const barAlt = new Map<string, number>();
    for (const item of voice.items) {
      if (item.kind === 'bar') {
        line += ` ${item.style} `;
        barAlt.clear();
      } else if (item.kind === 'rest') line += `z${lengthText(item.dur / tune.unit)} `;
      else {
        const parts = item.pitches.map((p) => {
          const id = `${p.step}${p.octave}`;
          const sticky = barAlt.get(id);
          // An accidental written earlier in the bar carries on, so only a change from that needs writing.
          const own = pitchText(p, sticky === undefined ? keyAlt : keyAlt.map((a, s) => (s === p.step ? sticky : a)));
          barAlt.set(id, p.alt);
          return own;
        });
        const body2 = parts.length === 1 ? parts[0]! : `[${parts.join('')}]`;
        line += `${body2}${lengthText(item.dur / tune.unit)}${item.tied ? '-' : ''} `;
      }
    }
    body.push(line.replace(/\s+/g, ' ').trim());
  }
  return [...head, `K:${key.text}`, ...body].join('\n');
}

export const accidentalSign = (alt: number): string => accidental(alt);
export const diatonicIndex = (n: Note): number => n.octave * 7 + n.step;
export const semitoneOf = (n: Note): number => n.octave * 12 + MAJOR[n.step]! + n.alt;
