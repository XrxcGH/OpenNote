// The theory tool's form: a mode choice and the fields each mode shows.
import { choice, only, plainChoice } from '../spec';
import type { Field } from '../spec';
import { CENTS_SCALES, SCALES } from './scales';
import { INSTRUMENTS, scaleLabel } from './practice';
import type { Values } from '../shared';

export const MODES = [
  ['interval', 'thInterval'],
  ['above', 'thAbove'],
  ['pitch', 'thPitch'],
  ['scale', 'thScale'],
  ['melakarta', 'thMelakarta'],
  ['cents', 'thCents'],
  ['chord', 'thChord'],
  ['name', 'thName'],
  ['key', 'thKey'],
  ['roman', 'thRoman'],
  ['instrument', 'thInstrument'],
  ['pcset', 'thPcset'],
  ['row', 'thRow'],
  ['jazz', 'thJazz'],
  ['twofive', 'thTwoFive'],
  ['guitar', 'thGuitar'],
] as const satisfies readonly (readonly [string, string])[];

/** The name shown for a scale id: the table's name, or the id with a capital letter and spaces between its words. */
export function nameOf(id: string): string {
  const known = scaleLabel(id);
  if (known !== id) return known;
  const spaced = id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const mode = (v: Values): string => v.mode ?? 'interval';
const on = (...modes: string[]) => only('mode', 'interval', ...modes);

const text = (id: string, label: Field['label'], initial: string, when?: Field['when'], hint?: Field['hint']): Field => ({
  id,
  label,
  initial,
  kind: 'text',
  ...(when ? { when } : {}),
  ...(hint ? { hint } : {}),
});

export const FIELDS: readonly Field[] = [
  choice('mode', 'thMode', 'interval', MODES),
  text('note1', 'thNote1', 'C4', on('interval'), 'thNoteHint'),
  text('note2', 'thNote2', 'G4', on('interval'), 'thNoteHint'),
  text('base', 'thBase', 'C4', on('above', 'instrument'), 'thNoteHint'),
  text('interval', 'thIntervalName', 'M3', on('above'), 'thIntervalHint'),
  choice(
    'direction',
    'thDirection',
    'up',
    [
      ['up', 'thUp'],
      ['down', 'thDown'],
    ],
    on('above'),
  ),
  text('pitch', 'thPitchIn', 'A4', on('pitch'), 'thPitchHint'),
  text('a4', 'thA4', '440', on('pitch')),
  text('tonic', 'thTonic', 'C', on('scale', 'melakarta', 'cents', 'key', 'roman', 'twofive'), 'thTonicHint'),
  plainChoice('scaleId', 'thScaleId', 'ionian', SCALES.map((s) => [s.id, nameOf(s.id)] as const), on('scale')),
  text('melaNumber', 'thMelaNumber', '15', on('melakarta'), 'thMelaHint'),
  plainChoice('centsId', 'thCentsId', 'rast', CENTS_SCALES.map((s) => [s.id, nameOf(s.id)] as const), on('cents')),
  text('chord', 'thChordIn', 'Cmaj7', on('chord', 'jazz', 'guitar', 'roman'), 'thChordHint'),
  text('notes', 'thNotesIn', 'C3 E3 G3 B3', on('name'), 'thNotesHint'),
  text('romanNotes', 'thRomanNotesIn', '', on('roman'), 'thRomanNotesHint'),
  choice(
    'keyMode',
    'thKeyMode',
    'major',
    [
      ['major', 'thMajor'],
      ['minor', 'thMinor'],
    ],
    on('key', 'roman', 'twofive'),
  ),
  plainChoice('instrumentId', 'thInstrumentId', 'clarinetBb', INSTRUMENTS.map((i) => [i.id, i.name] as const), on('instrument')),
  choice(
    'transposeDir',
    'thTransposeDir',
    'written',
    [
      ['written', 'thToWritten'],
      ['concert', 'thToConcert'],
    ],
    on('instrument'),
  ),
  text('set', 'thSet', '0 4 7', on('pcset'), 'thSetHint'),
  text('row', 'thRowIn', '0 11 3 4 8 7 9 5 6 1 2 10', on('row'), 'thRowHint'),
];
