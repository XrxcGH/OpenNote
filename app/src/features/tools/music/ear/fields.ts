// The ear-training form: the drill, one item or a session, the seed, the settings, and the answer.
import { choice } from '../spec';
import type { Field } from '../spec';
import type { Values } from '../shared';

export const MODES = [
  ['interval', 'earInterval'],
  ['chord', 'earChord'],
  ['scale', 'earScale'],
  ['melody', 'earMelody'],
  ['rhythm', 'earRhythm'],
  ['sing', 'earSing'],
] as const satisfies readonly (readonly [string, string])[];

const mode = (v: Values): string => v.mode ?? 'interval';
const single = (v: Values): boolean => v.run !== 'session' || mode(v) === 'sing';
const graded = (v: Values): boolean => v.run === 'session' && mode(v) !== 'sing';

const todayText = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const FIELDS: readonly Field[] = [
  choice('mode', 'earMode', 'interval', MODES),
  choice(
    'run',
    'earRun',
    'item',
    [
      ['item', 'earOneItem'],
      ['session', 'earSession'],
    ],
    (v) => mode(v) !== 'sing',
  ),
  { id: 'seed', label: 'earSeed', initial: '1', kind: 'text', hint: 'earSeedHint' },
  choice('level', 'earLevel', 'easy', [
    ['easy', 'earEasy'],
    ['medium', 'earMedium'],
    ['hard', 'earHard'],
  ]),
  choice(
    'range',
    'earRange',
    'mid',
    [
      ['low', 'earLow'],
      ['mid', 'earMid'],
      ['high', 'earHigh'],
    ],
    (v) => mode(v) === 'interval' || mode(v) === 'chord',
  ),
  choice(
    'delivery',
    'earDelivery',
    'up',
    [
      ['up', 'earUp'],
      ['down', 'earDown'],
      ['together', 'earTogether'],
    ],
    (v) => mode(v) === 'interval' || mode(v) === 'chord',
  ),
  {
    id: 'length',
    label: 'earLength',
    initial: '4',
    kind: 'number',
    when: (v) => mode(v) === 'melody' || mode(v) === 'sing',
  },
  { id: 'bpm', label: 'earBpm', initial: '80', kind: 'number' },
  {
    id: 'item',
    label: 'earItem',
    initial: '1',
    kind: 'number',
    hint: 'earItemHint',
    when: single,
  },
  {
    id: 'answer',
    label: 'earAnswer',
    initial: '',
    kind: 'text',
    hint: 'earAnswerHint',
    when: (v) => single(v) && mode(v) !== 'sing',
  },
  choice(
    'solfege',
    'earSolfege',
    'la',
    [
      ['la', 'earLaBased'],
      ['do', 'earDoBased'],
    ],
    (v) => mode(v) === 'sing',
  ),
  { id: 'answers', label: 'earAnswers', initial: '', kind: 'area', hint: 'earAnswersHint', when: graded },
  { id: 'today', label: 'earToday', initial: todayText(), kind: 'text', when: graded },
];
