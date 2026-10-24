// The tuning modes: ratios, cents, and frequencies; temperament tables; beat rates; the harmonic series; and equal
// divisions of the octave.
import { centsOf, nearestNote, parseRatio, ratioOf } from '../pitch';
import { fail, fixed, fmt, need, ok, positive, readNumber, signed, textTable } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import {
  CIRCLES,
  PURE_FIFTH,
  PYTHAGOREAN_COMMA,
  SYNTONIC_COMMA,
  fifths,
  harmonicSeries,
  nearestStep,
  stepCents,
  tunedIntervals,
  tuningTable,
} from './tuning';
import type { TuningId } from './tuning';

export function convert(v: Values): KitOk {
  const typedRatio = (v.ratio ?? '').trim();
  const base = positive(v, 'base', 'rhyBase');
  let ratio: number;
  let cents: number;
  if (typedRatio !== '') {
    const parsed = parseRatio(typedRatio);
    if (parsed === null) return fail('rhyRatioFormat');
    ratio = parsed;
    cents = centsOf(ratio);
  } else {
    cents = need(v, 'cents', 'rhyCentsIn');
    ratio = ratioOf(cents);
  }
  const near = nearestNote(base * ratio, 440);
  const semitones = cents / 100;
  const rows: KitRow[] = [
    { key: 'centsOut', value: fixed(cents, 3) },
    { key: 'ratioOut', value: fmt(ratio, 8) },
    { key: 'semitonesOut', value: fixed(semitones, 4) },
    { key: 'hzAbove', value: `${fmt(base * ratio, 8)} Hz` },
    {
      key: 'nearestEqual',
      value: `${fixed(Math.round(semitones), 0)} semitones, ${fixed(cents - Math.round(semitones) * 100, 2)} cents`,
    },
    {
      key: 'nearestNoteAbove',
      value: `${near.name} ${near.cents >= 0 ? '+' : '−'}${fixed(Math.abs(near.cents), 1)} cents`,
    },
  ];
  const steps: KitStep[] = [
    { key: 'convCents', vars: { ratio: fmt(ratio, 8), cents: fixed(cents, 3) } },
    { key: 'convHz', vars: { base: fmt(base), ratio: fmt(ratio, 8), hz: fmt(base * ratio, 8) } },
  ];
  return ok({
    rows,
    steps,
    answer: `A ratio of ${fmt(ratio, 6)} is ${fixed(cents, 3)} cents`,
    notes: ['rhyNoteCents'],
  });
}

const TUNING_SOURCE = 'Werckmeister III and Kirnberger III by their published fifths';

export function temperament(v: Values): KitOk {
  const id = (v.tuning ?? 'meantone') as TuningId;
  const a4 = positive(v, 'a4', 'rhyA4');
  const table = tuningTable(id, a4);
  const lines = textTable(
    [
      ['Note', 'Cents', 'Hz', 'vs equal'],
      ...table.map((n) => [n.name, fixed(n.cents, 3), fixed(n.hz, 3), fixed(n.versusEqual, 3)]),
    ],
    [5, 10, 11, 10],
  );
  const rows: KitRow[] = [{ key: 'tuningCount', value: '12' }];
  const circle = CIRCLES[id];
  if (circle) {
    const sizes = fifths(circle);
    const widest = Math.max(...sizes);
    const narrowest = Math.min(...sizes);
    rows.push(
      { key: 'narrowestFifth', value: `${fixed(narrowest, 3)} cents` },
      { key: 'widestFifth', value: `${fixed(widest, 3)} cents` },
    );
  }
  return ok({
    rows,
    steps: [
      {
        key: 'tuneCircle',
        vars: { pure: fixed(PURE_FIFTH, 3), comma: fixed(PYTHAGOREAN_COMMA, 3), syntonic: fixed(SYNTONIC_COMMA, 3) },
      },
      { key: 'tuneBuild' },
      { key: 'tuneHz', vars: { a4: fmt(a4) } },
    ],
    answer: `${table.map((n) => `${n.name} ${fixed(n.cents, 1)}`).join(', ')}`,
    code: lines,
    notes: ['rhyNoteTuning', 'rhyNoteTonic'],
    source: id === 'werckmeister' || id === 'kirnberger' ? TUNING_SOURCE : undefined,
  });
}

const INTERVAL_ORDER = ['fifth', 'fourth', 'majorThird', 'minorThird'] as const;

export function beats(v: Values): KitOk {
  const id = (v.tuning ?? 'meantone') as TuningId;
  const tonic = Number(v.tonic ?? '0');
  const a4 = positive(v, 'a4', 'rhyA4');
  const intervals = tunedIntervals(id, tonic, a4);
  const rows: KitRow[] = [];
  for (const name of INTERVAL_ORDER) {
    const interval = intervals.find((i) => i.name === name)!;
    rows.push({
      key: `${name}Row` as const,
      value: `${fixed(interval.cents, 2)} cents (${signed(interval.error, 2)}), ${fixed(interval.beats, 2)} beats per second`,
    });
  }
  return ok({
    rows,
    steps: [{ key: 'beatFormula' }, { key: 'beatFifth', vars: { beats: fixed(intervals[0]!.beats, 3) } }],
    answer: `Fifth ${fixed(intervals[0]!.beats, 2)} beats per second, major third ${fixed(intervals[2]!.beats, 2)}`,
    notes: ['rhyNoteBeats'],
  });
}

export function series(v: Values): KitOk {
  const fundamental = positive(v, 'fundamental', 'rhyFundamental');
  const count = Math.round(positive(v, 'partials', 'rhyPartials'));
  if (count < 2 || count > 32) return fail('rhyPartialsRange');
  const parts = harmonicSeries(fundamental, count);
  const lines = textTable(
    [
      ['n', 'Hz', 'Cents', 'Nearest note'],
      ...parts.map((p) => [
        String(p.n),
        fixed(p.hz, 2),
        fixed(p.cents, 2),
        `${p.nearest.name} ${signed(p.nearest.cents, 1)}`,
      ]),
    ],
    [4, 10, 10, 18],
  );
  const seventh = parts[6];
  return ok({
    rows: [
      { key: 'partialCount', value: fmt(count) },
      { key: 'highestPartial', value: `${fmt(parts[parts.length - 1]!.hz, 6)} Hz` },
    ],
    steps: [
      { key: 'seriesFormula', vars: { f: fmt(fundamental) } },
      { key: 'seriesCents' },
      ...(seventh ? [{ key: 'seriesSeventh' as const, vars: { cents: fixed(seventh.nearest.cents, 1) } }] : []),
    ],
    answer: `Partials of ${fmt(fundamental)} Hz: ${parts
      .slice(0, 8)
      .map((p) => fmt(p.hz, 6))
      .join(', ')}`,
    code: lines,
    notes: ['rhyNoteSeries'],
  });
}

const TARGETS: readonly (readonly [string, number])[] = [
  ['3/2', 3 / 2],
  ['4/3', 4 / 3],
  ['5/4', 5 / 4],
  ['6/5', 6 / 5],
  ['7/4', 7 / 4],
  ['9/8', 9 / 8],
];

export function edo(v: Values): KitOk {
  const n = readNumber(v.divisions ?? '');
  if (n === null || !Number.isInteger(n) || n < 1 || n > 360) return fail('rhyDivisionsRange');
  const lines = textTable(
    [
      ['Ratio', 'Pure', 'Step', 'Size', 'Error'],
      ...TARGETS.map(([name, ratio]) => {
        const cents = centsOf(ratio);
        const near = nearestStep(n, cents);
        return [name, fixed(cents, 2), String(near.step), fixed(near.step * stepCents(n), 2), signed(near.error, 2)];
      }),
    ],
    [7, 10, 6, 10, 9],
  );
  const fifth = nearestStep(n, PURE_FIFTH);
  const third = nearestStep(n, centsOf(5 / 4));
  return ok({
    rows: [
      { key: 'stepSize', value: `${fixed(stepCents(n), 4)} cents` },
      {
        key: 'fifthStep',
        value: `${fifth.step} steps, error ${fifth.error >= 0 ? '+' : '−'}${fixed(Math.abs(fifth.error), 2)} cents`,
      },
      {
        key: 'thirdStep',
        value: `${third.step} steps, error ${third.error >= 0 ? '+' : '−'}${fixed(Math.abs(third.error), 2)} cents`,
      },
    ],
    steps: [{ key: 'edoStep', vars: { n: fmt(n), cents: fixed(stepCents(n), 4) } }, { key: 'edoNearest' }],
    answer: `${n}-tone equal temperament has steps of ${fixed(stepCents(n), 3)} cents`,
    code: lines,
    notes: ['rhyNoteEdo'],
  });
}
