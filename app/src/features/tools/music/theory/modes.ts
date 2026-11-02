// The theory modes: intervals, pitch, scales from several traditions, chords, keys, Roman numerals, transposing
// instruments, pitch-class sets, twelve-tone rows, jazz, and guitar shapes. The spelling engines are in this folder; this
// file reads the form, calls them, and shapes the answer.
import { fail, fixed, fmt, ok, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import type { PlayNote, PlayPlan } from '../audio';
import { hzToMidi, midiName, midiToHz, nearestNote, ratioOf } from '../pitch';
import { figuredBass, nameChord, parseChord } from './chords';
import { analyze, diatonicChords, fifthsOf, keyNotes, relativeKey, signature } from './keys';
import type { Mode, Pc } from './keys';
import {
  between,
  enharmonics,
  hzOf,
  intervalShort,
  intervalWords,
  invert,
  makeInterval,
  midiOf,
  noteName,
  parseInterval,
  parseNote,
  parsePitchClass,
  pitchClass,
  pitchClassName,
  shift,
  transposeNote,
} from './notes';
import type { Note } from './notes';
import {
  chordScales,
  concertNote,
  guitarShapes,
  instrument,
  ranges,
  shapeText,
  twoFiveOne,
  writtenNote,
} from './practice';
import {
  complementSet,
  forteName,
  intervalVector,
  invertSet,
  isRow,
  mod12,
  normalForm,
  primeForm,
  rowInversion,
  rowMatrix,
  rowRetrograde,
  uniquePcs,
  zMate,
} from './pcset';
import {
  SOURCES,
  centsScale,
  melakarta,
  nearestSemitone,
  sargam,
  scaleDef,
  scaleSemitones,
  spellMelakarta,
  spellScale,
} from './scales';

const names = (notes: readonly Note[]): string => notes.map((n) => noteName(n)).join(' ');
const pcNames = (notes: readonly Note[]): string => notes.map((n) => pitchClassName(n)).join(' ');

const DIGITS = '0123456789te';
/** A pitch-class list written with t for ten and e for eleven. */
export const setText = (pcs: readonly number[]): string => pcs.map((p) => DIGITS[mod12(p)]).join('');
const csv = (pcs: readonly number[]): string => pcs.join(', ');
const MINUS = '−';
const signedInt = (n: number): string => `${n < 0 ? MINUS : '+'}${Math.abs(n)}`;

/** A plan that plays notes one after another, a beat each, or all together. */
function tonePlan(notes: readonly Note[], bpm = 100, together = false): PlayPlan {
  const list: PlayNote[] = notes.map((n, i) => ({
    at: together ? 0 : i,
    dur: together ? 2 : 1,
    hz: hzOf(n),
    level: 1,
    voice: 'tone',
  }));
  return { notes: list, beats: together ? 2 : notes.length, bpm, loop: false };
}

function readNote(v: Values, id: string, label: 'thNote1' | 'thNote2' | 'thBase'): Note {
  return parseNote(v[id] ?? '', 4) ?? fail('thNoteFormat', { field: label });
}

const readTonic = (v: Values): Pc => parsePitchClass(v.tonic ?? '') ?? fail('thTonicFormat');
const readMode = (v: Values): Mode => (v.keyMode === 'minor' ? 'minor' : 'major');
const tonicNote = (pc: Pc): Note => ({ ...pc, octave: 4 });

function readChord(v: Values) {
  return parseChord(v.chord ?? '', 4) ?? fail('thChordFormat', { text: (v.chord ?? '').trim() });
}

function readNotes(text: string, minimum: number): Note[] {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const notes = tokens.map((t) => parseNote(t, 4));
  if (tokens.length < minimum || notes.some((n) => n === null))
    return fail('thNotesFormat', { count: String(minimum) });
  return notes as Note[];
}

// --- intervals and pitch ----------------------------------------------------------------------------------------------

export function interval(v: Values): KitOk {
  const a = readNote(v, 'note1', 'thNote1');
  const b = readNote(v, 'note2', 'thNote2');
  const { interval: i, descending } = between(a, b);
  const low = descending ? b : a;
  const high = descending ? a : b;
  const octaves = Math.floor((i.generic - 1) / 7);
  const simple = i.generic > 8 ? makeInterval(((i.generic - 1) % 7) + 1, i.semitones - 12 * octaves) : null;
  const rows: KitRow[] = [
    { key: 'intervalOut', value: intervalWords(i) },
    { key: 'shortName', value: intervalShort(i) },
    { key: 'semitoneCount', value: String(i.semitones) },
  ];
  if (simple) rows.push({ key: 'simpleOut', value: intervalWords(simple) });
  rows.push({ key: 'inversionOut', value: intervalWords(invert(i)) });
  rows.push({ key: 'etRatio', value: fmt(2 ** (i.semitones / 12), 6) });
  rows.push({ key: 'centsOut', value: String(i.semitones * 100) });
  const others = enharmonics(high).map(noteName);
  if (others.length > 0) rows.push({ key: 'enharmonicOut', value: others.slice(0, 4).join(', ') });
  const steps: KitStep[] = [
    { key: 'thIntervalCount', vars: { low: noteName(low), high: noteName(high), generic: String(i.generic) } },
    { key: 'thIntervalSemis', vars: { semis: String(i.semitones) } },
    { key: 'thIntervalQuality', vars: { semis: String(i.semitones), name: intervalWords(i) } },
  ];
  if (descending) steps.unshift({ key: 'thIntervalDescending' });
  return ok({
    rows,
    steps,
    answer: `${noteName(a)} to ${noteName(b)}: ${intervalWords(i)}${descending ? ' (descending)' : ''}, ${i.semitones} semitones`,
    play: tonePlan([a, b], 90),
    notes: ['thNoteSpelling'],
  });
}

export function above(v: Values): KitOk {
  const base = readNote(v, 'base', 'thBase');
  const i = parseInterval(v.interval ?? '') ?? fail('thIntervalFormat');
  const down = v.direction === 'down';
  const result = transposeNote(base, i, down);
  if (Math.abs(result.alt) > 2) return fail('thTooManyAccidentals', { note: noteName(result) });
  return ok({
    rows: [
      { key: 'noteOut', value: noteName(result) },
      { key: 'midiOut', value: String(midiOf(result)) },
      { key: 'enharmonicOut', value: enharmonics(result).slice(0, 3).map(noteName).join(', ') || '—' },
    ],
    steps: [
      { key: down ? 'thAboveCountDown' : 'thAboveCount', vars: { base: noteName(base), generic: String(i.generic) } },
      { key: 'thAboveSemis', vars: { semis: String(i.semitones), name: intervalWords(i) } },
    ],
    answer: `${intervalShort(i)} ${down ? 'below' : 'above'} ${noteName(base)} is ${noteName(result)}`,
    play: tonePlan(down ? [result, base] : [base, result], 90),
    notes: ['thNoteSpelling'],
  });
}

export function pitch(v: Values): KitOk {
  const a4 = readNumber(v.a4 ?? '');
  if (a4 === null || a4 < 200 || a4 > 900) return fail('thA4Range');
  const text = (v.pitch ?? '').trim();
  if (text === '') return fail('thPitchFormat');
  let midi: number;
  let hz: number;
  const steps: KitStep[] = [];
  const note = parseNote(text);
  if (note) {
    midi = midiOf(note);
    hz = midiToHz(midi, a4);
    steps.push({ key: 'thPitchFromNote', vars: { note: noteName(note), midi: String(midi) } });
    steps.push({ key: 'thPitchHz', vars: { midi: String(midi), a4: fmt(a4), hz: fmt(hz, 6) } });
  } else if (/hz$/i.test(text) || /\./.test(text) || Number(text) > 127) {
    const value = readNumber(text.replace(/\s*hz$/i, ''));
    if (value === null || value <= 0) return fail('thPitchFormat');
    hz = value;
    midi = hzToMidi(hz, a4);
    steps.push({ key: 'thPitchFromHz', vars: { hz: fmt(hz, 6), a4: fmt(a4), midi: fmt(midi, 6) } });
  } else {
    const value = readNumber(text);
    if (value === null || value < 0 || value > 127) return fail('thPitchFormat');
    midi = value;
    hz = midiToHz(midi, a4);
    steps.push({ key: 'thPitchHz', vars: { midi: fmt(midi), a4: fmt(a4), hz: fmt(hz, 6) } });
  }
  const near = nearestNote(hz, a4);
  return ok({
    rows: [
      { key: 'hzOut', value: fmt(hz, 6) },
      { key: 'midiExact', value: fmt(midi, 6) },
      { key: 'nearestNote', value: near.name },
      { key: 'offCents', value: fixed(near.cents, 1) },
      { key: 'flatName', value: midiName(near.midi, true) },
    ],
    steps,
    answer: `${near.name} = MIDI ${near.midi} = ${fmt(midiToHz(near.midi, a4), 6)} Hz (A4 = ${fmt(a4)} Hz)`,
    play: { notes: [{ at: 0, dur: 2, hz, level: 1, voice: 'tone' }], beats: 2, bpm: 90, loop: false },
    notes: ['thNoteTemperament'],
  });
}

// --- scales ----------------------------------------------------------------------------------------------------------------

function stepPattern(semis: readonly number[]): string {
  const all = [...semis, 12];
  return all
    .slice(1)
    .map((s, i) => s - all[i]!)
    .join('-');
}

export function scale(v: Values): KitOk {
  const tonic = readTonic(v);
  const def = scaleDef(v.scaleId ?? 'ionian');
  const notes = spellScale(tonicNote(tonic), def.degrees);
  const semis = scaleSemitones(def.degrees);
  const rows: KitRow[] = [
    { key: 'scaleNotes', value: pcNames(notes) },
    { key: 'scaleDegrees', value: def.degrees.replace(/b/g, '♭').replace(/#/g, '♯') },
    { key: 'stepPattern', value: stepPattern(semis) },
    { key: 'noteCount', value: String(semis.length) },
  ];
  if (def.family === 'thaat') rows.push({ key: 'sargamOut', value: sargam(def.degrees).join(' ') });
  const steps: KitStep[] = [
    { key: 'thScaleSpelled', vars: { tonic: pitchClassName(tonic), degrees: def.degrees } },
    { key: 'thScaleSteps', vars: { pattern: stepPattern(semis) } },
  ];
  if (def.family === 'thaat') steps.push({ key: 'thScaleSargam' });
  return ok({
    rows,
    steps,
    answer: `${pitchClassName(tonic)} ${def.id}: ${pcNames(notes)}`,
    play: tonePlan(notes, 140),
    notes: def.family === 'western' ? [] : ['thNoteFamily'],
    source: SOURCES.scales,
  });
}

export function melakartaMode(v: Values): KitOk {
  const tonic = readTonic(v);
  const number = readNumber(v.melaNumber ?? '');
  if (number === null || !Number.isInteger(number) || number < 1 || number > 72) return fail('thMelaRange');
  const m = melakarta(number);
  const notes = spellMelakarta(tonicNote(tonic), m);
  const chakra = Math.floor((number - 1) / 6) + 1;
  return ok({
    rows: [
      { key: 'melaNames', value: m.names.join(' ') },
      { key: 'scaleNotes', value: pcNames(notes) },
      { key: 'melaSemis', value: m.semitones.join(' ') },
      { key: 'melaChakra', value: String(chakra) },
    ],
    steps: [
      { key: 'thMelaChakra', vars: { chakra: String(chakra), n: String(number) } },
      { key: 'thMelaMa', vars: { ma: number > 36 ? 'M2' : 'M1' } },
      { key: 'thMelaSpelled', vars: { tonic: pitchClassName(tonic) } },
    ],
    answer: `Melakarta ${number} on ${pitchClassName(tonic)}: ${m.names.join(' ')} = ${pcNames(notes)}`,
    play: tonePlan(notes, 140),
    notes: ['thNoteMela'],
    source: SOURCES.scales,
  });
}

export function cents(v: Values): KitOk {
  const tonic = readTonic(v);
  const def = centsScale(v.centsId ?? 'rast');
  const base = hzOf(tonicNote(tonic));
  const near = def.cents.map((c) => {
    const n = nearestSemitone(c);
    return `${signedInt(n.semis)} (${signedInt(Math.round(n.off))}¢)`;
  });
  return ok({
    rows: [
      { key: 'centsList', value: def.cents.join(', ') },
      { key: 'nearestList', value: near.join('; ') },
      { key: 'hzList', value: def.cents.map((c) => fmt(base * ratioOf(c), 5)).join(', ') },
    ],
    steps: [
      { key: 'thCentsRatio', vars: { cents: String(def.cents[1] ?? 0), ratio: fmt(ratioOf(def.cents[1] ?? 0), 5) } },
      { key: 'thCentsHz', vars: { tonic: noteName(tonicNote(tonic)), hz: fmt(base, 6) } },
    ],
    answer: `${def.id} on ${noteName(tonicNote(tonic))}: ${def.cents.join(', ')} cents`,
    play: {
      notes: def.cents.map((c, i) => ({
        at: i,
        dur: 1,
        hz: base * ratioOf(c),
        level: 1 as const,
        voice: 'tone' as const,
      })),
      beats: def.cents.length,
      bpm: 120,
      loop: false,
    },
    notes: ['thNoteCents'],
    source: def.family === 'maqam' ? SOURCES.maqam : SOURCES.gamelan,
  });
}

// --- chords ----------------------------------------------------------------------------------------------------------------

const INVERSION_ROWS = ['invRoot', 'invFirst', 'invSecond', 'invThird'] as const;
const INVERSION_WORDS = ['wordRoot', 'wordFirst', 'wordSecond', 'wordThird'] as const;

export function chordMode(v: Values): KitOk {
  const chord = readChord(v);
  const q = chord.quality;
  const stack = chord.notes.slice(0, q.stack);
  const rows: KitRow[] = [
    { key: 'symbolOut', value: chord.symbol },
    { key: 'chordNotes', value: pcNames(chord.notes) },
    { key: 'chordDegrees', value: q.degrees.replace(/b/g, '♭').replace(/#/g, '♯') },
    { key: 'chordSemis', value: stack.map((n) => midiOf(n) - midiOf(chord.root)).join(' ') },
  ];
  if (q.stack >= 3 && q.stack <= 4) {
    for (let i = 0; i < q.stack; i++) {
      const order = [...stack.slice(i), ...stack.slice(0, i)];
      rows.push({ key: INVERSION_ROWS[i]!, value: `${order.map(pitchClassName).join(' ')} (${figuredBass(q, i)})` });
    }
  }
  const ordered = chord.bass ? [{ ...chord.bass, octave: 3 }, ...chord.notes] : chord.notes;
  return ok({
    rows,
    steps: [
      { key: 'thChordDegrees', vars: { root: pitchClassName(chord.root), degrees: q.degrees } },
      { key: 'thChordSpelled', vars: { notes: pcNames(chord.notes) } },
    ],
    answer: `${chord.symbol}: ${pcNames(chord.notes)}`,
    play: tonePlan(ordered, 90, true),
    notes: ['thNoteChord'],
  });
}

export function nameMode(v: Values): KitOk {
  const notes = readNotes(v.notes ?? '', 2);
  const matches = nameChord(notes);
  const best = matches[0];
  if (!best) return fail('thNameNone');
  const rows: KitRow[] = [
    { key: 'symbolOut', value: best.symbol },
    { key: 'positionOut', value: '', word: INVERSION_WORDS[best.inversion] ?? 'wordRoot' },
  ];
  if (best.quality.stack <= 4) rows.push({ key: 'figuresOut', value: figuredBass(best.quality, best.inversion) });
  if (matches.length > 1)
    rows.push({
      key: 'otherReadings',
      value: matches
        .slice(1, 4)
        .map((m) => m.symbol)
        .join(', '),
    });
  return ok({
    rows,
    steps: [
      { key: 'thNameStack', vars: { notes: pcNames(notes) } },
      { key: 'thNameRoot', vars: { symbol: best.symbol } },
    ],
    answer: `${names(notes)} is ${best.symbol}`,
    play: tonePlan(notes, 90, true),
  });
}

// --- keys and Roman numerals ---------------------------------------------------------------------------------------

function signatureText(fifths: number): string {
  if (fifths === 0) return 'none';
  return `${Math.abs(fifths)} ${fifths > 0 ? '♯' : '♭'}: ${signature(fifths).join(' ')}`;
}

export function key(v: Values): KitOk {
  const tonic = readTonic(v);
  const mode = readMode(v);
  const fifths = fifthsOf(tonic, mode);
  const other: Mode = mode === 'major' ? 'minor' : 'major';
  const rel = relativeKey(tonic, mode);
  const dominant = shift(tonicNote(tonic), 4, 7);
  const subdominant = shift(tonicNote(tonic), 3, 5);
  const chords = diatonicChords(tonic, mode);
  const steps: KitStep[] = [
    { key: 'thKeyFifths', vars: { key: `${pitchClassName(tonic)} ${mode}`, fifths: String(Math.abs(fifths)) } },
    { key: 'thKeyRelative', vars: { rel: pitchClassName(rel) } },
  ];
  if (Math.abs(fifths) > 7) steps.push({ key: 'thKeyTheoretical' });
  return ok({
    rows: [
      { key: 'signatureOut', value: signatureText(fifths) },
      { key: 'scaleNotes', value: pcNames(keyNotes(tonic, mode)) },
      { key: 'relativeOut', value: `${pitchClassName(rel)} ${other}` },
      { key: 'parallelOut', value: `${pitchClassName(tonic)} ${other}` },
      { key: 'dominantKey', value: `${pitchClassName(dominant)} ${mode}` },
      { key: 'subdominantKey', value: `${pitchClassName(subdominant)} ${mode}` },
      { key: 'diatonicOut', value: chords.map((c) => `${c.numeral} ${c.symbol}`).join(', ') },
    ],
    steps,
    answer: `${pitchClassName(tonic)} ${mode}: ${signatureText(fifths)}`,
    play: tonePlan(spellScale(tonicNote(tonic), mode === 'major' ? '1 2 3 4 5 6 7' : '1 2 b3 4 5 b6 b7'), 140),
    notes: mode === 'minor' ? ['thNoteMinor'] : [],
  });
}

const KIND_WORDS = {
  diatonic: 'kindDiatonic',
  secondary: 'kindSecondary',
  borrowed: 'kindBorrowed',
  neapolitan: 'kindNeapolitan',
  augmentedSixth: 'kindAugSixth',
  chromatic: 'kindChromatic',
} as const;

export function roman(v: Values): KitOk {
  const tonic = readTonic(v);
  const mode = readMode(v);
  const own = (v.romanNotes ?? '').trim();
  let notes: Note[];
  let label: string;
  if (own !== '') {
    notes = readNotes(own, 2);
    label = pcNames(notes);
  } else {
    const chord = readChord(v);
    notes = chord.bass ? [{ ...chord.bass, octave: 3 }, ...chord.notes] : chord.notes;
    label = chord.symbol;
  }
  const result = analyze(tonic, mode, notes);
  if (!result) return fail('thRomanNone');
  const keyName = `${pitchClassName(tonic)} ${mode}`;
  const rows: KitRow[] = [
    { key: 'numeralOut', value: result.numeral },
    { key: 'kindOut', value: '', word: KIND_WORDS[result.kind] },
  ];
  if (result.kind === 'secondary' && result.detail) rows.push({ key: 'tonicizing', value: result.detail });
  return ok({
    rows,
    steps: [
      { key: 'thRomanRoot', vars: { chord: label, key: keyName } },
      { key: 'thRomanKind', vars: { numeral: result.numeral } },
    ],
    answer: `${label} in ${keyName}: ${result.numeral}`,
    play: tonePlan(notes, 90, true),
    notes: ['thNoteRoman'],
  });
}

export function twoFive(v: Values): KitOk {
  const tonic = readTonic(v);
  const mode = readMode(v);
  const chords = twoFiveOne(tonic, mode);
  return ok({
    rows: chords.map((c, i) => ({
      key: (['chordTwo', 'chordFive', 'chordOne'] as const)[i]!,
      value: `${c.symbol}: ${pcNames(c.notes)}`,
    })),
    steps: [{ key: 'thTwoFiveBuilt', vars: { key: `${pitchClassName(tonic)} ${mode}` } }],
    answer: chords.map((c) => c.symbol).join(' – '),
    play: {
      notes: chords.flatMap((c, i) =>
        c.notes.map((n) => ({ at: i * 2, dur: 2, hz: hzOf(n), level: 1 as const, voice: 'tone' as const })),
      ),
      beats: 6,
      bpm: 90,
      loop: false,
    },
    notes: ['thNoteJazz'],
  });
}

// --- instruments -----------------------------------------------------------------------------------------------------

export function instrumentMode(v: Values): KitOk {
  const inst = instrument(v.instrumentId ?? 'clarinetBb');
  const base = readNote(v, 'base', 'thBase');
  const toWritten = v.transposeDir !== 'concert';
  const result = toWritten ? writtenNote(base, inst) : concertNote(base, inst);
  if (Math.abs(result.alt) > 2) return fail('thTooManyAccidentals', { note: noteName(result) });
  const r = ranges(inst);
  const show = (pair: [Note, Note]) => `${noteName(pair[0])} to ${noteName(pair[1])}`;
  return ok({
    rows: [
      { key: toWritten ? 'writtenOut' : 'concertOut', value: noteName(result) },
      { key: 'writtenRange', value: show(r.written) },
      { key: 'concertRange', value: show(r.concert) },
    ],
    steps: [
      {
        key: toWritten ? 'thInstWritten' : 'thInstConcert',
        vars: { inst: inst.name, from: noteName(base), to: noteName(result) },
      },
    ],
    answer: toWritten
      ? `Concert ${noteName(base)} is written ${noteName(result)} for ${inst.name}`
      : `Written ${noteName(base)} sounds ${noteName(result)} on ${inst.name}`,
    play: tonePlan([toWritten ? base : result], 90),
    notes: ['thNoteRange'],
  });
}

// --- pitch-class sets and rows -------------------------------------------------------------------------------------

function readPcs(text: string, field: 'thSet' | 'thRowIn'): number[] {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const token of tokens) {
    const named = /^[A-G][#b♯♭]*$/.test(token) ? parsePitchClass(token) : null;
    if (/^\d+$/.test(token)) out.push(mod12(Number(token)));
    else if (named) out.push(pitchClass(named));
    else if (token === 't' || token === 'T') out.push(10);
    else if (token === 'e') out.push(11);
    else return fail('thSetFormat', { field });
  }
  if (out.length === 0) return fail('thSetFormat', { field });
  return out;
}

export function pcset(v: Values): KitOk {
  const raw = readPcs(v.set ?? '', 'thSet');
  const pcs = uniquePcs(raw);
  const normal = normalForm(pcs);
  const prime = primeForm(pcs);
  const name = forteName(pcs);
  const vector = intervalVector(pcs);
  const z = zMate(pcs);
  const vectorText = `<${vector.some((n) => n > 9) ? vector.join(',') : vector.join('')}>`;
  const rows: KitRow[] = [
    { key: 'pcsOut', value: csv(pcs) },
    { key: 'normalForm', value: `[${setText(normal)}]` },
    { key: 'primeForm', value: `(${setText(prime)})` },
    { key: 'forteOut', value: name ?? '—' },
    { key: 'vectorOut', value: vectorText },
    { key: 'complementOut', value: setText(complementSet(pcs)) || '—' },
    { key: 'inversionSet', value: `[${setText(normalForm(invertSet(pcs)))}]` },
  ];
  if (z) rows.push({ key: 'zMate', value: `${z.name} (${setText(z.prime)})` });
  const steps: KitStep[] = [
    { key: 'thSetNormal', vars: { set: setText(pcs), normal: setText(normal) } },
    { key: 'thSetPrime', vars: { prime: setText(prime) } },
  ];
  if (raw.length !== pcs.length) steps.unshift({ key: 'thSetDuplicates' });
  return ok({
    rows,
    steps,
    answer: `{${csv(pcs)}}: prime form (${setText(prime)}), Forte ${name ?? 'none'}, interval vector ${vectorText}`,
    notes: ['thNoteSets'],
  });
}

export function rowMode(v: Values): KitOk {
  const row = readPcs(v.row ?? '', 'thRowIn');
  if (!isRow(row)) {
    const have = new Set(row);
    const missing = Array.from({ length: 12 }, (_, i) => i).filter((i) => !have.has(i));
    return fail('thRowNot', { count: String(row.length), missing: missing.map((m) => DIGITS[m]).join(' ') || 'none' });
  }
  const start = row[0]!;
  const inv = rowInversion(row, start);
  const matrix = rowMatrix(row);
  const vars = { n: String(start) };
  return ok({
    rows: [
      { key: 'rowP', value: csv(row), vars },
      { key: 'rowI', value: csv(inv), vars },
      { key: 'rowR', value: csv(rowRetrograde(row)), vars },
      { key: 'rowRI', value: csv(rowRetrograde(inv)), vars },
    ],
    steps: [{ key: 'thRowChecked' }, { key: 'thRowInverted', vars: { start: String(start) } }, { key: 'thRowMatrix' }],
    answer: `P${start} = ${csv(row)}; I${start} = ${csv(inv)}`,
    code: matrix.map((r) => r.map((p) => DIGITS[p]).join(' ')).join('\n'),
    notes: ['thNoteMatrix'],
  });
}

// --- jazz and guitar -----------------------------------------------------------------------------------------------

export function jazz(v: Values): KitOk {
  const chord = readChord(v);
  const options = chordScales(chord.root, chord.quality);
  return ok({
    rows: options.map((o, i) => ({
      key: i === 0 ? ('scaleFirst' as const) : ('scaleOther' as const),
      value: `${o.name}: ${pcNames(o.notes)}`,
    })),
    steps: [
      { key: 'thJazzQuality', vars: { symbol: chord.symbol } },
      { key: 'thJazzFirst', vars: { name: options[0]?.name ?? '' } },
    ],
    answer: `${chord.symbol}: ${options.map((o) => o.name).join(', ')}`,
    ...(options[0] ? { play: tonePlan(options[0].notes, 140) } : {}),
    notes: ['thNoteJazz'],
  });
}

export function guitar(v: Values): KitOk {
  const chord = readChord(v);
  const shapes = guitarShapes(chord.root, chord.quality, chord.bass);
  if (shapes.length === 0) return fail('thGuitarNone', { symbol: chord.symbol });
  return ok({
    rows: shapes.map((s, i) => ({ key: 'shapeN' as const, vars: { n: String(i + 1) }, value: shapeText(s) })),
    steps: [{ key: 'thGuitarTuning' }, { key: 'thGuitarSearch', vars: { symbol: chord.symbol } }],
    answer: `${chord.symbol}: ${shapes.map(shapeText).join(' or ')}`,
    code: shapes.map(shapeText).join('\n'),
    notes: ['thNoteGuitar'],
  });
}
