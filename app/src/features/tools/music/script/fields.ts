// The script formatter's form: a mode, a layout, and the Fountain text.
import { choice } from '../spec';
import type { Field } from '../spec';
import type { Values } from '../shared';

export const MODES = [
  ['format', 'scFormat'],
  ['classify', 'scClassify'],
  ['scenes', 'scScenes'],
  ['characters', 'scCharacters'],
  ['locations', 'scLocations'],
  ['breakdown', 'scBreakdown'],
] as const satisfies readonly (readonly [string, string])[];

export const mode = (v: Values): string => v.mode ?? 'format';

export const SAMPLE = [
  'Title: The Last Bus',
  'Author: A Student',
  '',
  'INT. KITCHEN - NIGHT',
  '',
  'A single lamp burns over the table. ANNA, thirties, ties the laces of her boots. A KETTLE hisses.',
  '',
  'ANNA',
  '(quietly)',
  'Hello?',
  '',
  'BEN (O.S.)',
  'You said midnight.',
  '',
  'CUT TO:',
  '',
  'EXT. BUS STOP - CONTINUOUS',
  '',
  'Rain. Ben waits under an UMBRELLA, checking his watch.',
  '',
  'BEN',
  'She is not coming.',
  '',
  'ANNA (V.O.)',
  'I am already here.',
  '',
].join('\n');

export const FIELDS: readonly Field[] = [
  choice('mode', 'scMode', 'format', MODES),
  choice('layout', 'scLayout', 'screenplay', [
    ['screenplay', 'scScreenplay'],
    ['stage', 'scStage'],
  ]),
  { id: 'script', label: 'scScript', initial: SAMPLE, kind: 'area', hint: 'scScriptHint' },
];
