// The tuning and rhythm tool's form: a mode choice and the fields each mode shows.
import { choice, only } from '../spec';
import type { Field } from '../spec';
import { CYCLES, PATTERNS } from './rhythm';
import type { Values } from '../shared';

export const MODES = [
  ['convert', 'rhyConvert'],
  ['temperament', 'rhyTemperament'],
  ['beats', 'rhyBeats'],
  ['series', 'rhySeries'],
  ['edo', 'rhyEdo'],
  ['euclid', 'rhyEuclid'],
  ['cycle', 'rhyCycle'],
  ['pattern', 'rhyPattern'],
  ['poly', 'rhyPoly'],
  ['tempo', 'rhyTempo'],
  ['metronome', 'rhyMetronome'],
] as const satisfies readonly (readonly [string, string])[];

export const mode = (v: Values): string => v.mode ?? 'convert';
const on = (...modes: string[]) => only('mode', 'convert', ...modes);

const TUNINGS = [
  ['equal', 'rhyEqual'],
  ['just', 'rhyJust'],
  ['pythagorean', 'rhyPythagorean'],
  ['meantone', 'rhyMeantone'],
  ['werckmeister', 'rhyWerckmeister'],
  ['kirnberger', 'rhyKirnberger'],
] as const;

const TONICS = [
  ['0', 'rhyC'],
  ['1', 'rhyCSharp'],
  ['2', 'rhyD'],
  ['3', 'rhyEFlat'],
  ['4', 'rhyE'],
  ['5', 'rhyF'],
  ['6', 'rhyFSharp'],
  ['7', 'rhyG'],
  ['8', 'rhyGSharp'],
  ['9', 'rhyA'],
  ['10', 'rhyBFlat'],
  ['11', 'rhyB'],
] as const;

const CYCLE_LABELS = {
  teentaal: 'rhyTeentaal',
  jhaptaal: 'rhyJhaptaal',
  rupak: 'rhyRupak',
  ektaal: 'rhyEktaal',
  dadra: 'rhyDadra',
  keherwa: 'rhyKeherwa',
  deepchandi: 'rhyDeepchandi',
  adi: 'rhyAdi',
} as const;

const PATTERN_LABELS = {
  son: 'rhySon',
  rumba: 'rhyRumba',
  bossa: 'rhyBossa',
  shiko: 'rhyShiko',
  gahu: 'rhyGahu',
  souku: 'rhySouku',
  bembe: 'rhyBembe',
  tresillo: 'rhyTresillo',
  cinquillo: 'rhyCinquillo',
  habanera: 'rhyHabanera',
  maqsum: 'rhyMaqsum',
  baladi: 'rhyBaladi',
  saidi: 'rhySaidi',
  malfuf: 'rhyMalfuf',
} as const;

const SPEED = ['convert', 'temperament', 'beats', 'series', 'edo'];

export const FIELDS: readonly Field[] = [
  choice('mode', 'rhyMode', 'convert', MODES),
  { id: 'ratio', label: 'rhyRatio', initial: '5/4', hint: 'rhyRatioHint', when: on('convert') },
  { id: 'cents', label: 'rhyCentsIn', initial: '', hint: 'rhyCentsHint', when: on('convert') },
  { id: 'base', label: 'rhyBase', initial: '261.626', when: on('convert') },
  choice('tuning', 'rhyTuning', 'meantone', TUNINGS, on('temperament', 'beats')),
  choice('tonic', 'rhyTonic', '0', TONICS, on('beats')),
  { id: 'a4', label: 'rhyA4', initial: '440', when: on('temperament', 'beats') },
  { id: 'fundamental', label: 'rhyFundamental', initial: '110', when: on('series') },
  { id: 'partials', label: 'rhyPartials', initial: '16', when: on('series') },
  { id: 'divisions', label: 'rhyDivisions', initial: '19', when: on('edo') },
  { id: 'onsets', label: 'rhyOnsets', initial: '5', when: on('euclid') },
  { id: 'steps', label: 'rhySteps', initial: '8', when: on('euclid') },
  { id: 'rotation', label: 'rhyRotation', initial: '0', when: on('euclid') },
  choice(
    'cycleId',
    'rhyCycleId',
    'teentaal',
    CYCLES.map((c) => [c.id, CYCLE_LABELS[c.id as keyof typeof CYCLE_LABELS]] as const),
    on('cycle'),
  ),
  choice(
    'patternId',
    'rhyPatternId',
    'son',
    PATTERNS.map((p) => [p.id, PATTERN_LABELS[p.id as keyof typeof PATTERN_LABELS]] as const),
    on('pattern'),
  ),
  { id: 'polyA', label: 'rhyPolyA', initial: '3', when: on('poly') },
  { id: 'polyB', label: 'rhyPolyB', initial: '2', when: on('poly') },
  { id: 'swing', label: 'rhySwing', initial: '2:1', hint: 'rhySwingHint', when: on('tempo') },
  { id: 'bar', label: 'rhyBar', initial: '4', when: on('metronome') },
  choice(
    'sub',
    'rhySub',
    '1',
    [
      ['1', 'rhySubNone'],
      ['2', 'rhySubEighths'],
      ['3', 'rhySubTriplets'],
      ['4', 'rhySubSixteenths'],
    ],
    on('metronome'),
  ),
  choice(
    'accent',
    'rhyAccent',
    'first',
    [
      ['first', 'rhyAccentFirst'],
      ['none', 'rhyAccentNone'],
    ],
    on('metronome'),
  ),
  choice(
    'spb',
    'rhyStepsPerBeat',
    '2',
    [
      ['1', 'rhyOnePerBeat'],
      ['2', 'rhyTwoPerBeat'],
      ['4', 'rhyFourPerBeat'],
    ],
    on('euclid', 'pattern', 'poly'),
  ),
  {
    id: 'bpm',
    label: 'rhyBpm',
    initial: '120',
    when: (v) => !SPEED.includes(mode(v)),
  },
];
