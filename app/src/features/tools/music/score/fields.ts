// The score block's form: ABC text, what to do with it, and the options of each.
import { choice, only, plainChoice } from '../spec';
import type { Field } from '../spec';
import { INSTRUMENTS } from '../theory/practice';
import type { Values } from '../shared';

export const MODES = [
  ['engrave', 'scoreEngrave'],
  ['transpose', 'scoreTranspose'],
  ['instrument', 'scoreInstrument'],
  ['jianpu', 'scoreJianpu'],
  ['sargam', 'scoreSargam'],
  ['tab', 'scoreTab'],
] as const satisfies readonly (readonly [string, string])[];

export const mode = (v: Values): string => v.mode ?? 'engrave';

export const SAMPLE = 'X:1\nT:C major scale\nM:4/4\nL:1/8\nQ:1/4=100\nK:C\nCDEF GABc|';

export const FIELDS: readonly Field[] = [
  choice('mode', 'scoreMode', 'engrave', MODES),
  { id: 'abc', label: 'scoreAbc', initial: SAMPLE, kind: 'area', hint: 'scoreAbcHint' },
  { id: 'voice', label: 'scoreVoice', initial: '', kind: 'text', hint: 'scoreVoiceHint' },
  {
    id: 'interval',
    label: 'scoreInterval',
    initial: 'M2',
    kind: 'text',
    hint: 'scoreIntervalHint',
    when: only('mode', 'engrave', 'transpose'),
  },
  choice(
    'direction',
    'scoreDirection',
    'up',
    [
      ['up', 'scoreUp'],
      ['down', 'scoreDown'],
    ],
    only('mode', 'engrave', 'transpose'),
  ),
  {
    id: 'toKey',
    label: 'scoreToKey',
    initial: '',
    kind: 'text',
    hint: 'scoreToKeyHint',
    when: only('mode', 'engrave', 'transpose'),
  },
  plainChoice(
    'instrumentId',
    'scoreInstrumentId',
    'clarinetBb',
    INSTRUMENTS.map((i) => [i.id, i.name] as const),
    only('mode', 'engrave', 'instrument'),
  ),
];
