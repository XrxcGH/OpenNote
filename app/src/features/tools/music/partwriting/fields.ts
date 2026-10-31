// The voice-leading checker's form.
import { choice, only } from '../spec';
import type { Field } from '../spec';
import type { Values } from '../shared';

export const MODES = [
  ['chorale', 'pwChorale'],
  ['species', 'pwSpecies'],
] as const satisfies readonly (readonly [string, string])[];

export const mode = (v: Values): string => v.mode ?? 'chorale';
const on = (...modes: string[]) => only('mode', 'chorale', ...modes);

export const FIELDS: readonly Field[] = [
  choice('mode', 'pwMode', 'chorale', MODES),
  { id: 'tonic', label: 'pwTonic', initial: 'C', kind: 'text', hint: 'pwTonicHint', when: on('chorale') },
  choice(
    'keyMode',
    'pwKeyMode',
    'major',
    [
      ['major', 'pwMajor'],
      ['minor', 'pwMinor'],
    ],
    on('chorale'),
  ),
  choice(
    'strictness',
    'pwStrictness',
    'standard',
    [
      ['relaxed', 'pwRelaxed'],
      ['standard', 'pwStandard'],
      ['strict', 'pwStrict'],
    ],
    on('chorale'),
  ),
  {
    id: 'chords',
    label: 'pwChords',
    initial: 'E5 G4 E4 C3\nC5 A4 F4 F3\nB4 G4 D4 G3\nC5 G4 E4 C3',
    kind: 'area',
    hint: 'pwChordsHint',
    when: on('chorale'),
  },
  choice(
    'species',
    'pwSpeciesNo',
    '1',
    [
      ['1', 'pwFirst'],
      ['2', 'pwSecond'],
      ['3', 'pwThird'],
      ['4', 'pwFourth'],
    ],
    on('species'),
  ),
  choice(
    'position',
    'pwPosition',
    'above',
    [
      ['above', 'pwAbove'],
      ['below', 'pwBelow'],
    ],
    on('species'),
  ),
  {
    id: 'cantus',
    label: 'pwCantus',
    initial: 'C4 D4 E4 D4 C4',
    kind: 'text',
    hint: 'pwCantusHint',
    when: on('species'),
  },
  { id: 'line', label: 'pwLine', initial: 'G4 F4 G4 B4 C5', kind: 'text', hint: 'pwLineHint', when: on('species') },
];
