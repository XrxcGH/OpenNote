// The nuclear science tool's decay calculations: one nuclide's decay and activity, and a decay chain by the Bateman
// equations.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { Reader } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, ResultRow, Tone } from '../kit/types';
import { fromSI, unitOf } from '../kit/units';
import { NUCLIDES, nuclideById } from './data';
import { bateman, daughterPeak, decayConstant, remaining, timeToFraction } from './engine';

const K = 'kitPhysics.nuclear';
const RADIOACTIVE = NUCLIDES.filter((one) => one.halfLife !== undefined);

/** A time unit that suits a span: years, days, hours, or seconds. */
export function timeUnit(seconds: number): string {
  if (seconds >= 2 * 365.25 * 86_400) return 'y';
  if (seconds >= 2 * 86_400) return 'd';
  if (seconds >= 2 * 3600) return 'h';
  return 's';
}

const time = (seconds: number, unit = timeUnit(seconds)) => qIn(seconds, 'time', unit);

/** The rate unit that matches a time unit, such as 1/y for y; 1/s when there is none. */
const perUnit = (unit: string): string => (unitOf('rate', `1/${unit}`) ? `1/${unit}` : '1/s');

/** The half-life typed, or the table's for the nuclide picked, with the step that says which. */
function readHalfLife(read: Reader): { T: number; unit: string; step?: KitStep } {
  const id = read.choice('nuclide');
  if (id === 'custom') return { T: read.num('halfLife', 'positive'), unit: read.unit('halfLife') };
  const found = nuclideById(id);
  if (!found?.halfLife) return fail(`${K}.errors.nuclide`);
  const unit = timeUnit(found.halfLife);
  return {
    T: found.halfLife,
    unit,
    step: { key: `${K}.s.tableHalfLife`, vars: { id, T: time(found.halfLife, unit) } },
  };
}

function decayCurve(T: number, until: number, unit: string, mark: number): Plot {
  const end = Math.max(until * 1.2, 4 * T);
  const points: [number, number][] = [];
  for (let i = 0; i <= 200; i++) {
    const t = (end * i) / 200;
    points.push([fromSI(t, 'time', unit), remaining(T, t)]);
  }
  const halves = [1, 2, 3].map((n) => fromSI(n * T, 'time', unit)).filter((x) => x <= fromSI(end, 'time', unit));
  return {
    frame: 'axes',
    alt: { key: `${K}.plot.decay`, vars: { T: time(T, unit) } },
    x: { label: `t (${unit})`, min: 0 },
    y: { label: 'N / N₀', min: 0, max: 1 },
    series: [
      { points, tone: 'accent', width: 2 },
      ...halves.map((x, i) => ({
        points: [
          [x, 0],
          [x, 0.5 ** (i + 1)],
        ] as [number, number][],
        tone: 'muted' as const,
        dash: true,
      })),
      {
        points: [
          [fromSI(mark, 'time', unit), 0],
          [fromSI(mark, 'time', unit), remaining(T, mark)],
        ],
        tone: 'danger',
        dash: true,
      },
    ],
    legend: [
      { tone: 'accent', key: `${K}.legend.remaining` },
      { tone: 'muted', key: `${K}.legend.halfLives`, dash: true },
      { tone: 'danger', key: `${K}.legend.time`, dash: true },
    ],
  };
}

export const decayMode: ModeDef = {
  id: 'decay',
  label: `${K}.modes.decay`,
  fields: [
    {
      id: 'nuclide',
      label: `${K}.f.nuclide`,
      kind: 'choice',
      initial: 'custom',
      options: [
        { value: 'custom', label: `${K}.o.custom` },
        ...RADIOACTIVE.map((one) => ({ value: one.id, label: `${K}.nuclides.${one.id}` as MessageKey })),
      ],
    },
    {
      id: 'halfLife',
      label: `${K}.f.halfLife`,
      dim: 'time',
      unit: 'y',
      usUnit: 'y',
      initial: '5730',
      when: (ch) => ch('nuclide') === 'custom',
    },
    {
      id: 'find',
      label: `${K}.f.find`,
      kind: 'choice',
      initial: 'time',
      options: [
        { value: 'time', label: `${K}.o.findTime` },
        { value: 'amount', label: `${K}.o.findAmount` },
      ],
    },
    { id: 'percent', label: `${K}.f.percent`, initial: '25', when: (ch) => ch('find') === 'time' },
    {
      id: 't',
      label: `${K}.f.elapsed`,
      dim: 'time',
      unit: 'y',
      usUnit: 'y',
      initial: '1000',
      when: (ch) => ch('find') === 'amount',
    },
    { id: 'N0', label: `${K}.f.N0`, initial: '', optional: true, help: `${K}.help.N0` },
  ],
  solve(read): Outcome {
    const { T, unit, step } = readHalfLife(read);
    const lambda = decayConstant(T);
    const per = perUnit(unit);
    const N0 = read.opt('N0', 'positive');
    const findTime = read.choice('find') === 'time';
    const t = findTime
      ? timeToFraction(T, read.num('percent', { above: 0, max: 100 }) / 100)
      : read.num('t', 'nonNegative');
    const fraction = remaining(T, t);
    const rows: ResultRow[] = [
      findTime
        ? { key: `${K}.r.time`, symbol: 't', value: t, dim: 'time', unit, usUnit: unit, primary: true }
        : { key: `${K}.r.fraction`, symbol: 'N/N₀', value: fraction, primary: true },
      { key: `${K}.r.halfLives`, symbol: 't/T½', value: t / T },
      { key: `${K}.r.lambda`, symbol: 'λ', value: lambda, dim: 'rate', unit: per, usUnit: per },
      { key: `${K}.r.meanLife`, symbol: 'τ', value: 1 / lambda, dim: 'time', unit, usUnit: unit },
    ];
    const steps: KitStep[] = [
      ...(step ? [step] : []),
      { key: `${K}.s.lambda`, vars: { T: time(T, unit), lambda: qIn(lambda, 'rate', per) } },
      findTime
        ? { key: `${K}.s.timeTo`, vars: { T: time(T, unit), fraction: fmt(fraction), t: time(t, unit) } }
        : { key: `${K}.s.fraction`, vars: { t: time(t, unit), T: time(T, unit), fraction: fmt(fraction) } },
    ];
    if (N0 !== null) {
      const A0 = lambda * N0;
      rows.push(
        { key: `${K}.r.left`, symbol: 'N', value: N0 * fraction },
        { key: `${K}.r.activity0`, symbol: 'A₀', value: A0, dim: 'activity', unit: 'Bq', usUnit: 'Ci' },
        { key: `${K}.r.activity`, symbol: 'A', value: A0 * fraction, dim: 'activity', unit: 'Bq', usUnit: 'Ci' },
      );
      steps.push({
        key: `${K}.s.activity`,
        vars: { lambda: qIn(lambda, 'rate', '1/s'), N0: fmt(N0), A0: q(A0, 'Bq'), A: q(A0 * fraction, 'Bq') },
      });
    }
    return {
      ok: true,
      rows,
      latex: 'N=N_0\\,2^{-t/T_{1/2}}=N_0e^{-\\lambda t},\\qquad \\lambda=\\frac{\\ln 2}{T_{1/2}},\\qquad A=\\lambda N',
      steps,
      notes: [{ key: `${K}.notes.decay` }],
      ...(read.choice('nuclide') === 'custom' ? {} : { source: `${K}.source` as MessageKey }),
      plot: decayCurve(T, t, unit, t),
    };
  },
};

const TONES: Tone[] = ['accent', 'second', 'third', 'danger'];

export const chainMode: ModeDef = {
  id: 'chain',
  label: `${K}.modes.chain`,
  intro: `${K}.help.chain`,
  fields: [
    {
      id: 'given',
      label: `${K}.f.given`,
      kind: 'choice',
      initial: 'constant',
      options: [
        { value: 'constant', label: `${K}.o.constant` },
        { value: 'halfLife', label: `${K}.o.halfLife` },
      ],
    },
    {
      id: 'byConstant',
      label: `${K}.f.members`,
      kind: 'rows',
      initial: '0.1 1000\n0.05 0',
      columns: [{ label: `${K}.f.lambda`, dim: 'rate', unit: '1/s' }, { label: `${K}.f.amount` }],
      when: (ch) => ch('given') === 'constant',
    },
    {
      id: 'byHalfLife',
      label: `${K}.f.members`,
      kind: 'rows',
      initial: '6.9315 1000\n13.863 0',
      columns: [{ label: `${K}.f.halfLife`, dim: 'time', unit: 's' }, { label: `${K}.f.amount` }],
      when: (ch) => ch('given') === 'halfLife',
    },
    {
      id: 'stable',
      label: `${K}.f.stable`,
      kind: 'choice',
      initial: 'no',
      options: [
        { value: 'no', label: `${K}.o.no` },
        { value: 'yes', label: `${K}.o.yes` },
      ],
    },
    { id: 't', label: `${K}.f.elapsed`, dim: 'time', unit: 's', usUnit: 's', initial: '10' },
  ],
  solve(read): Outcome {
    const byConstant = read.choice('given') === 'constant';
    const lines = read.rows(byConstant ? 'byConstant' : 'byHalfLife');
    const lambdas = lines.map(([value]) => (byConstant ? value : value > 0 ? decayConstant(value) : NaN));
    const initial = lines.map(([, amount]) => amount);
    if (lambdas.some((one) => !(one > 0))) fail(`${K}.errors.chainConstant`);
    if (initial.some((one) => one < 0)) fail(`${K}.errors.chainAmount`);
    const stable = read.choice('stable') === 'yes';
    if (stable) {
      lambdas.push(0);
      initial.push(0);
    }
    if (lambdas.length > 4) fail(`${K}.errors.chainLength`);
    const t = read.num('t', 'nonNegative');
    const unit = read.unit('t');
    const amounts = bateman(lambdas, initial, t);
    const name = (i: number) => String.fromCharCode(65 + i);
    const rows: ResultRow[] = amounts.flatMap((amount, i) => [
      { key: `${K}.r.member`, symbol: `N_${name(i)}`, value: amount, primary: i === 1 || amounts.length === 1 },
      ...(lambdas[i] > 0
        ? [
            {
              key: `${K}.r.memberActivity` as MessageKey,
              symbol: `A_${name(i)}`,
              value: lambdas[i] * amount,
              dim: 'activity' as const,
              unit: 'Bq',
              usUnit: 'Bq',
            },
          ]
        : []),
    ]);
    const steps: KitStep[] = lambdas.map((lambda, i) => ({
      key: lambda > 0 ? `${K}.s.member` : `${K}.s.stableMember`,
      vars: { name: name(i), lambda: qIn(lambda, 'rate', '1/s'), N0: fmt(initial[i]) },
    }));
    steps.push({ key: `${K}.s.bateman`, vars: { t: qIn(t, 'time', unit) } });
    amounts.forEach((amount, i) => steps.push({ key: `${K}.s.amount`, vars: { name: name(i), N: fmt(amount) } }));
    const peak =
      lambdas.length >= 2 && initial.slice(1).every((one) => one === 0) ? daughterPeak(lambdas[0], lambdas[1]) : null;
    if (peak !== null) {
      rows.push({ key: `${K}.r.peak`, symbol: 't_max', value: peak, dim: 'time', unit, usUnit: unit });
      steps.push({ key: `${K}.s.peak`, vars: { t: qIn(peak, 'time', unit) } });
    }
    const notes: KitStep[] = [{ key: `${K}.notes.chain` }];
    if (lambdas.length >= 2 && lambdas[1] > 0) {
      if (lambdas[1] > 10 * lambdas[0])
        notes.push({ key: lambdas[1] > 1000 * lambdas[0] ? `${K}.notes.secular` : `${K}.notes.transient` });
      else if (lambdas[1] < lambdas[0]) notes.push({ key: `${K}.notes.noEquilibrium` });
    }
    return {
      ok: true,
      rows,
      latex:
        'N_n(t)=\\sum_{i=1}^{n}N_i(0)\\Big(\\prod_{j=i}^{n-1}\\lambda_j\\Big)' +
        '\\sum_{k=i}^{n}\\frac{e^{-\\lambda_k t}}{\\prod_{l=i,\\,l\\ne k}^{n}(\\lambda_l-\\lambda_k)}',
      steps,
      notes,
      plot: chainPlot(lambdas, initial, t, unit),
    };
  },
};

function chainPlot(lambdas: readonly number[], initial: readonly number[], t: number, unit: string): Plot {
  const slowest = Math.min(...lambdas.filter((one) => one > 0));
  const end = t > 0 ? 1.5 * t : 5 / slowest;
  const series = lambdas.map((_, i) => ({ points: [] as [number, number][], tone: TONES[i % TONES.length], width: 2 }));
  for (let step = 0; step <= 200; step++) {
    const at = (end * step) / 200;
    const amounts = bateman(lambdas, initial, at);
    amounts.forEach((amount, i) => series[i].points.push([fromSI(at, 'time', unit), amount]));
  }
  const top = Math.max(...series.flatMap((one) => one.points.map(([, y]) => y)));
  return {
    frame: 'axes',
    alt: { key: `${K}.plot.chain`, vars: { count: String(lambdas.length) } },
    x: { label: `t (${unit})`, min: 0 },
    y: { label: 'N', min: 0 },
    series: [
      ...series,
      {
        points: [
          [fromSI(t, 'time', unit), 0],
          [fromSI(t, 'time', unit), top],
        ],
        tone: 'muted',
        dash: true,
      },
    ],
    legend: lambdas.map((_, i) => ({ tone: TONES[i % TONES.length], key: `${K}.legend.member${i + 1}` as MessageKey })),
  };
}
