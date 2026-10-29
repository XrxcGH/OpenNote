// The geochronology and isotope calculations as forms. They give ages from ratios, isochrons, U-Pb, potassium-argon
// methods with a plateau check, and radiocarbon with calibration; then stable isotopes, mineral formulas, and the
// geologic time scale.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import type { Figure, Mark } from '../core/figure';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor, when } from '../ui/fields';
import type { Mode, Reader } from '../ui/form';
import { looseT } from '../ui/form';
import {
  SYSTEMS,
  arArAge,
  calibrate,
  concordia,
  concordiaIntercepts,
  halfLife,
  jFactor,
  kArAge,
  normalization,
  plateau,
  radiocarbon,
  ratioAge,
} from './decay';
import { OXIDE_NAMES, alphaOf, formula, fractionation, mix } from './isotopes';
import type { Oxide } from './isotopes';
import { DIVISIONS, lookup, within } from './timescale';
import type { Rank } from './timescale';
import { york } from './york';

const { num, pick, text, r } = fieldsFor('dating');
const word = (key: string, vars?: Readonly<Record<string, string | number>>) => looseT(`kitEarth.dating.${key}`, vars);
const myr = (years: number) => fmt(years / 1e6, 6);

const ISOCHRON_SYSTEMS = ['rbsr', 'smnd', 'luhf', 'reos', 'custom'] as const;
const RATIO_SYSTEMS = ['rbsr', 'smnd', 'u238', 'u235', 'th232', 'luhf', 'reos', 'custom'] as const;

function lambdaOf(read: Reader, id: string): { lambda: number; source: string } {
  if (id === 'custom') {
    const lambda = read.num('lambda');
    check(lambda > 0, 'lambda');
    return { lambda, source: t('kitEarth.dating.sources.custom') };
  }
  return SYSTEMS[id as keyof typeof SYSTEMS];
}

const ratioMode: Mode = {
  id: 'ratio',
  label: 'kitEarth.dating.modes.ratio',
  fields: [
    pick('system', RATIO_SYSTEMS),
    num('lambda', '1.42e-11', undefined, undefined, { show: when('system', 'custom') }),
    pick('given', ['radiogenic', 'initial']),
    num('ratio', '0.01', undefined, undefined, { show: when('given', 'radiogenic') }),
    num('daughter', '0.7250', undefined, undefined, { show: when('given', 'initial') }),
    num('initial', '0.7040', undefined, undefined, { show: when('given', 'initial') }),
    num('parent', '1.5', undefined, undefined, { show: when('given', 'initial') }),
  ],
  solve(read) {
    const { lambda, source } = lambdaOf(read, read.pick('system'));
    const withInitial = read.pick('given') === 'initial';
    const ratio = withInitial ? (read.num('daughter') - read.num('initial')) / read.num('parent') : read.num('ratio');
    if (withInitial) check(read.num('parent') > 0, 'parent');
    const age = ratioAge(ratio, lambda);
    const vars = { age: myr(age), ratio: fmt(ratio, 6), lambda: fmt(lambda), half: fmt(halfLife(lambda) / 1e9, 6) };
    return {
      answer: t('kitEarth.dating.a.ratio', vars),
      latex: `t = \\frac{1}{\\lambda}\\ln\\left(1 + \\frac{D^*}{P}\\right) = ${tex(age / 1e6)}\\ \\mathrm{Myr}`,
      rows: [
        [r('age'), `${myr(age)} Myr`],
        [r('ratio'), fmt(ratio, 6)],
        [r('lambda'), `${fmt(lambda)} /yr`],
        [r('halfLife'), `${vars.half} Gyr`],
      ],
      steps: [
        ...(withInitial
          ? [
              t('kitEarth.dating.s.radiogenic', {
                d: fmt(read.num('daughter')),
                d0: fmt(read.num('initial')),
                p: fmt(read.num('parent')),
                ratio: vars.ratio,
              }),
            ]
          : []),
        t('kitEarth.dating.s.ratio', vars),
      ],
      source: t('kitEarth.dating.sources.lambda', { source }),
    };
  },
};

/** Rows of x, σx, y, σy, and an optional correlation; two columns mean y-only errors, as for an ordinary fit. */
function fitPoints(raw: string) {
  const rows = numberRows(raw, 2, 5);
  check(rows.length >= 2, 'points', { count: 2 });
  return rows.map((row) => {
    if (row.length < 4) return { x: row[0], y: row[1], sx: 1e-9 * (Math.abs(row[0]) || 1), sy: 1 };
    return { x: row[0], sx: row[1], y: row[2], sy: row[3], r: row[4] ?? 0 };
  });
}

const isochron: Mode = {
  id: 'isochron',
  label: 'kitEarth.dating.modes.isochron',
  intro: 'kitEarth.dating.intro.isochron',
  fields: [
    pick('system', ISOCHRON_SYSTEMS),
    num('lambda', '1.42e-11', undefined, undefined, { show: when('system', 'custom') }),
    text(
      'points',
      '0.50, 0.005, 0.71000, 0.00005\n1.20, 0.012, 0.71704, 0.00005\n2.40, 0.024, 0.72915, 0.00005\n3.10, 0.031, 0.73620, 0.00005',
    ),
  ],
  solve(read) {
    const { lambda, source } = lambdaOf(read, read.pick('system'));
    const points = fitPoints(read.raw('points'));
    const fit = york(points);
    check(fit.slope > -1, 'slope');
    const age = ratioAge(Math.max(fit.slope, 0), lambda);
    const scale = Number.isFinite(fit.mswd) ? Math.max(1, Math.sqrt(fit.mswd)) : 1;
    const ageError = (scale * fit.seSlope) / (lambda * (1 + fit.slope));
    const vars = {
      age: myr(age),
      error: myr(ageError),
      initial: fmt(fit.intercept, 6),
      mswd: Number.isFinite(fit.mswd) ? fmt(fit.mswd, 3) : '—',
      slope: fmt(fit.slope, 6),
    };
    const xs = points.map((p) => p.x);
    const lo = Math.min(0, ...xs);
    const hi = Math.max(...xs) * 1.1;
    return {
      answer: t('kitEarth.dating.a.isochron', vars),
      latex: `t = \\frac{\\ln(1 + m)}{\\lambda} = ${tex(age / 1e6)}\\ \\mathrm{Myr}`,
      rows: [
        [r('age'), `${vars.age} ± ${vars.error} Myr`],
        [r('slope'), `${vars.slope} ± ${fmt(scale * fit.seSlope, 3)}`],
        [r('initialRatio'), `${vars.initial} ± ${fmt(scale * fit.seIntercept, 3)}`],
        [r('mswd'), vars.mswd],
      ],
      steps: [
        t('kitEarth.dating.s.york', { count: points.length, iterations: fit.iterations }),
        t('kitEarth.dating.s.isochron', vars),
        t('kitEarth.dating.s.mswd', vars),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.dating.plot.isochronTitle'),
          description: t('kitEarth.dating.plot.isochronText', { count: points.length, ...vars }),
          xLabel: t('kitEarth.dating.plot.parent'),
          yLabel: t('kitEarth.dating.plot.daughter'),
          series: [
            { points: points.map((p) => [p.x, p.y] as const), dots: true, role: 's0' },
            {
              points: [
                [lo, fit.intercept + fit.slope * lo],
                [hi, fit.intercept + fit.slope * hi],
              ],
              role: 's1',
              label: t('kitEarth.dating.plot.fit'),
            },
          ],
        }),
      ],
      source: t('kitEarth.dating.sources.lambda', { source }),
    };
  },
};

/** The ²⁰⁷Pb/²⁰⁶Pb age, by bisection on (1/137.88)(e^(λ235 t) − 1)/(e^(λ238 t) − 1). */
function pbPbAge(ratio: number): number {
  const f = (t: number) => {
    const [x, y] = concordia(t);
    return x / (137.88 * y) - ratio;
  };
  check(f(1) < 0 && f(4.6e9) > 0, 'pbpb');
  let lo = 1;
  let hi = 4.6e9;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function concordiaFigure(
  points: readonly (readonly [number, number])[],
  line: [number, number] | null,
  top: number,
): Figure {
  const tMax = Math.max(top * 1.15, 100e6);
  const curve = Array.from({ length: 101 }, (_, k) => concordia((k / 100) * tMax));
  const step = tMax > 2e9 ? 500e6 : tMax > 800e6 ? 200e6 : 100e6;
  const ticks = (sx: (x: number) => number, sy: (y: number) => number): Mark[] =>
    Array.from({ length: Math.floor(tMax / step) }, (_, k) => (k + 1) * step).flatMap((age) => {
      const [x, y] = concordia(age);
      return [
        { kind: 'circle', cx: sx(x), cy: sy(y), r: 2, role: 'muted', fill: true },
        { kind: 'text', x: sx(x) - 4, y: sy(y) - 4, text: fmt(age / 1e6), role: 'muted', size: 9, anchor: 'end' },
      ] as Mark[];
    });
  const [xEnd] = concordia(tMax);
  return linePlot({
    title: t('kitEarth.dating.plot.concordiaTitle'),
    description: t('kitEarth.dating.plot.concordiaText', { count: points.length }),
    xLabel: t('kitEarth.dating.plot.x235'),
    yLabel: t('kitEarth.dating.plot.y238'),
    series: [
      { points: curve, role: 'axis', label: t('kitEarth.dating.plot.concordia') },
      ...(line
        ? [
            {
              points: [
                [0, line[0]],
                [xEnd, line[0] + line[1] * xEnd],
              ] as const,
              role: 's1' as const,
              dash: true,
              label: t('kitEarth.dating.plot.discordia'),
            },
          ]
        : []),
      ...(points.length ? [{ points, dots: true, role: 's0' as const }] : []),
    ],
    x: [0, xEnd],
    y: [0, concordia(tMax)[1]],
    extra: ticks,
  });
}

const upb: Mode = {
  id: 'upb',
  label: 'kitEarth.dating.modes.upb',
  intro: 'kitEarth.dating.intro.upb',
  fields: [
    pick('given', ['r206', 'both', 'discordia']),
    num('r206', '0.1', undefined, undefined, { show: (text) => text('given') !== 'discordia' }),
    num('r207', '0.83', undefined, undefined, { show: when('given', 'both') }),
    text(
      'analyses',
      '8.711, 0.087, 0.3951, 0.004, 0.9\n5.683, 0.057, 0.2772, 0.0028, 0.9\n3.664, 0.037, 0.1986, 0.002, 0.9',
      'area',
      {
        show: when('given', 'discordia'),
      },
    ),
  ],
  solve(read) {
    const given = read.pick('given');
    if (given === 'discordia') {
      const points = fitPoints(read.raw('analyses'));
      const fit = york(points);
      const hits = concordiaIntercepts(fit.intercept, fit.slope);
      check(hits.length > 0, 'intercepts');
      const upper = hits[hits.length - 1];
      const lower = hits.length > 1 ? hits[0] : null;
      const vars = {
        upper: myr(upper),
        lower: lower === null ? '—' : myr(lower),
        mswd: Number.isFinite(fit.mswd) ? fmt(fit.mswd, 3) : '—',
      };
      return {
        answer: t('kitEarth.dating.a.discordia', vars),
        rows: [
          [r('upper'), `${vars.upper} Myr`],
          [r('lower'), lower === null ? '—' : `${vars.lower} Myr`],
          [r('mswd'), vars.mswd],
        ],
        steps: [
          t('kitEarth.dating.s.york', { count: points.length, iterations: fit.iterations }),
          t('kitEarth.dating.s.intercepts', vars),
        ],
        figures: [
          concordiaFigure(
            points.map((p) => [p.x, p.y] as const),
            [fit.intercept, fit.slope],
            upper,
          ),
        ],
        source: t('kitEarth.dating.sources.lambda', { source: SYSTEMS.u238.source }),
      };
    }
    const r206 = read.num('r206');
    const t68 = ratioAge(r206, SYSTEMS.u238.lambda);
    const concordant = concordia(t68)[0];
    if (given === 'r206') {
      const vars = { age: myr(t68), r207: fmt(concordant, 6) };
      return {
        answer: t('kitEarth.dating.a.r206', vars),
        latex: `t = \\frac{\\ln(1 + {}^{206}\\mathrm{Pb}^*/{}^{238}\\mathrm{U})}{\\lambda_{238}} = ${tex(t68 / 1e6)}\\ \\mathrm{Myr}`,
        rows: [
          [r('age206'), `${vars.age} Myr`],
          [r('concordant'), vars.r207],
        ],
        steps: [t('kitEarth.dating.s.r206', { ratio: fmt(r206), ...vars }), t('kitEarth.dating.s.concordant', vars)],
        figures: [concordiaFigure([[concordant, r206]], null, t68)],
        source: t('kitEarth.dating.sources.lambda', { source: SYSTEMS.u238.source }),
      };
    }
    const r207 = read.num('r207');
    const t75 = ratioAge(r207, SYSTEMS.u235.lambda);
    const t76 = pbPbAge(r207 / (137.88 * r206));
    const discordance = 100 * (1 - t68 / t76);
    const vars = { t68: myr(t68), t75: myr(t75), t76: myr(t76), disc: fmt(discordance, 3) };
    return {
      answer: t('kitEarth.dating.a.both', vars),
      rows: [
        [r('age206'), `${vars.t68} Myr`],
        [r('age207'), `${vars.t75} Myr`],
        [r('age76'), `${vars.t76} Myr`],
        [r('discordance'), `${vars.disc}%`],
      ],
      steps: [
        t('kitEarth.dating.s.both', vars),
        t('kitEarth.dating.s.pbpb', vars),
        t('kitEarth.dating.s.discordance', vars),
      ],
      figures: [concordiaFigure([[r207, r206]], null, Math.max(t68, t75, t76))],
      source: t('kitEarth.dating.sources.lambda', { source: SYSTEMS.u238.source }),
    };
  },
};

const kar: Mode = {
  id: 'kar',
  label: 'kitEarth.dating.modes.kar',
  fields: [
    pick('method', ['kar', 'arar']),
    num('ratio', '0.01', undefined, undefined, { show: when('method', 'kar') }),
    num('lambdaK', '5.543e-10', undefined, undefined, { show: when('method', 'kar') }),
    num('lambdaEc', '0.581e-10', undefined, undefined, { show: when('method', 'kar') }),
    num('stdAge', '28.2', 'age', 'Myr', { show: when('method', 'arar') }),
    num('stdRatio', '1.5', undefined, undefined, { show: when('method', 'arar') }),
    num('sampleRatio', '6.0', undefined, undefined, { show: when('method', 'arar') }),
  ],
  solve(read) {
    if (read.pick('method') === 'kar') {
      const lambda = read.num('lambdaK');
      const ec = read.num('lambdaEc');
      const age = kArAge(read.num('ratio'), lambda, ec);
      const vars = { age: myr(age), ratio: fmt(read.num('ratio')), lambda: fmt(lambda), ec: fmt(ec) };
      return {
        answer: t('kitEarth.dating.a.kar', vars),
        latex:
          `t = \\frac{1}{\\lambda}\\ln\\left(1 + \\frac{\\lambda}{\\lambda_e}` +
          `\\frac{{}^{40}\\mathrm{Ar}^*}{{}^{40}\\mathrm{K}}\\right) = ${tex(age / 1e6)}\\ \\mathrm{Myr}`,
        rows: [
          [r('age'), `${vars.age} Myr`],
          [r('branch'), fmt(ec / lambda, 5)],
        ],
        steps: [t('kitEarth.dating.s.kar', vars)],
        source: t('kitEarth.dating.sources.lambda', { source: SYSTEMS.k40.source }),
      };
    }
    const j = jFactor(read.num('stdAge') / 31557600, read.num('stdRatio'));
    const age = arArAge(read.num('sampleRatio'), j);
    const vars = { j: fmt(j, 6), age: myr(age) };
    return {
      answer: t('kitEarth.dating.a.arar', vars),
      latex: `t = \\frac{1}{\\lambda}\\ln(1 + J R) = ${tex(age / 1e6)}\\ \\mathrm{Myr}`,
      rows: [
        [r('j'), vars.j],
        [r('age'), `${vars.age} Myr`],
      ],
      steps: [t('kitEarth.dating.s.j', vars), t('kitEarth.dating.s.arar', vars)],
      source: t('kitEarth.dating.sources.lambda', { source: SYSTEMS.k40.source }),
    };
  },
};

const plateauMode: Mode = {
  id: 'plateau',
  label: 'kitEarth.dating.modes.plateau',
  intro: 'kitEarth.dating.intro.plateau',
  fields: [text('steps', '5, 80, 2\n20, 100.5, 1\n30, 99.8, 1\n25, 100.2, 1\n20, 115, 2')],
  solve(read) {
    const steps = numberRows(read.raw('steps'), 3).map(([gas, age, sigma]) => ({ gas, age, sigma }));
    const p = plateau(steps);
    const total = steps.reduce((s, x) => s + x.gas, 0);
    let acc = 0;
    const spectrum: [number, number][] = [];
    for (const s of steps) {
      const from = (100 * acc) / total;
      acc += s.gas;
      const to = (100 * acc) / total;
      spectrum.push([from, s.age], [to, s.age]);
    }
    const vars = p
      ? { from: p.from, to: p.to, gas: fmt(p.gas, 3), age: fmt(p.age, 5), sigma: fmt(p.sigma, 3), mswd: fmt(p.mswd, 3) }
      : null;
    const ages = steps.map((s) => s.age);
    return {
      answer: vars ? t('kitEarth.dating.a.plateau', vars) : t('kitEarth.dating.a.noPlateau'),
      rows: vars
        ? [
            [r('steps'), `${vars.from}–${vars.to}`],
            [r('gas'), `${vars.gas}%`],
            [r('plateauAge'), `${vars.age} ± ${vars.sigma}`],
            [r('mswd'), vars.mswd],
          ]
        : [[r('steps'), word('none')]],
      steps: [t('kitEarth.dating.s.plateauRule'), ...(vars ? [t('kitEarth.dating.s.plateau', vars)] : [])],
      figures: [
        linePlot({
          title: t('kitEarth.dating.plot.spectrumTitle'),
          description: t('kitEarth.dating.plot.spectrumText', { count: steps.length }),
          xLabel: t('kitEarth.dating.plot.cumulative'),
          yLabel: t('kitEarth.dating.plot.stepAge'),
          x: [0, 100],
          y: [Math.min(...ages) * 0.95, Math.max(...ages) * 1.05],
          series: [{ points: spectrum, role: 's0' }],
          hlines: p ? [{ y: p.age, label: t('kitEarth.dating.plot.plateau') }] : [],
        }),
      ],
    };
  },
};

const carbon: Mode = {
  id: 'radiocarbon',
  label: 'kitEarth.dating.modes.radiocarbon',
  intro: 'kitEarth.dating.intro.radiocarbon',
  fields: [
    num('fraction', '0.5'),
    num('d13c', '', undefined, undefined, { optional: true }),
    num('sigma', '30', undefined, undefined, { optional: true }),
    num('year', '', undefined, undefined, { optional: true }),
    text('curve', '', 'area', { optional: true, rows: 4 }),
  ],
  solve(read) {
    const d13c = read.opt('d13c');
    const year = read.opt('year');
    const c = radiocarbon(read.num('fraction'), d13c, year);
    const vars = { age: fmt(c.age, 6), fn: fmt(c.fn, 6), pmc: fmt(c.pmc, 5) };
    const rows: [string, string][] = [
      [r('c14age'), `${vars.age} yr BP`],
      [r('fn'), vars.fn],
      [r('pmc'), vars.pmc],
    ];
    if (d13c !== null) rows.push([r('factor'), fmt(normalization(d13c), 6)]);
    if (c.big !== undefined) rows.push([r('big'), `${fmt(c.big, 5)}‰`]);
    const steps = [
      ...(d13c !== null
        ? [t('kitEarth.dating.s.normalize', { d13c: fmt(d13c), factor: fmt(normalization(d13c), 6), ...vars })]
        : []),
      t('kitEarth.dating.s.c14', vars),
    ];
    const figures: Figure[] = [];
    const rawCurve = read.raw('curve');
    if (rawCurve) {
      const sigma = read.opt('sigma');
      check(sigma !== null && sigma > 0, 'sigma');
      const curve = numberRows(rawCurve, 3).map(([cal, c14, s]) => ({ cal, c14, sigma: s }));
      const cal = calibrate(c.age, sigma!, curve);
      const list = (ranges: [number, number][]) => ranges.map(([a, b]) => `${a}–${b}`).join(', ');
      rows.push(
        [r('median'), `${cal.median} cal BP`],
        [r('range68'), `${list(cal.ranges68)} cal BP`],
        [r('range95'), `${list(cal.ranges95)} cal BP`],
      );
      steps.push(t('kitEarth.dating.s.calibrate', { count: curve.length }), t('kitEarth.dating.s.ranges'));
      figures.push(
        linePlot({
          title: t('kitEarth.dating.plot.calibrationTitle'),
          description: t('kitEarth.dating.plot.calibrationText', { age: vars.age, median: cal.median }),
          xLabel: t('kitEarth.dating.plot.calBp'),
          yLabel: t('kitEarth.dating.plot.probability'),
          series: [{ points: cal.density.map((p, i) => [cal.start + i, p] as const), role: 's0' }],
          vlines: [{ x: cal.median }],
        }),
      );
    }
    return {
      answer: t('kitEarth.dating.a.radiocarbon', vars),
      latex: `t = -8033\\ln F_N = ${tex(c.age)}\\ \\mathrm{yr\\ BP}`,
      rows,
      steps,
      figures,
      note: rawCurve ? undefined : t('kitEarth.dating.notes.curve'),
    };
  },
};

const isotopes: Mode = {
  id: 'isotopes',
  label: 'kitEarth.dating.modes.isotopes',
  fields: [
    pick('task', ['convert', 'rayleigh', 'mix']),
    num('deltaA', '10', undefined, undefined, { show: when('task', 'convert') }),
    num('deltaB', '0', undefined, undefined, { show: when('task', 'convert') }),
    num('delta0', '0', undefined, undefined, { show: when('task', 'rayleigh') }),
    num('alpha', '1.01', undefined, undefined, { show: when('task', 'rayleigh') }),
    num('f', '0.5', undefined, undefined, { show: when('task', 'rayleigh') }),
    text('members', '0.5, 10, -5\n0.5, 1, 5', 'area', { show: when('task', 'mix'), rows: 3 }),
  ],
  solve(read) {
    const task = read.pick('task');
    if (task === 'convert') {
      const c = alphaOf(read.num('deltaA'), read.num('deltaB'));
      const vars = { alpha: fmt(c.alpha, 8), epsilon: fmt(c.epsilon, 6), big: fmt(c.big, 6), ln: fmt(c.ln, 6) };
      return {
        answer: t('kitEarth.dating.a.convert', vars),
        latex: `\\alpha = \\frac{1000 + \\delta_A}{1000 + \\delta_B} = ${tex(c.alpha, 8)}`,
        rows: [
          [r('alpha'), vars.alpha],
          [r('epsilon'), `${vars.epsilon}‰`],
          [r('bigDelta'), `${vars.big}‰`],
          [r('lnAlpha'), `${vars.ln}‰`],
        ],
        steps: [t('kitEarth.dating.s.alpha', vars), t('kitEarth.dating.s.epsilon', vars)],
      };
    }
    if (task === 'rayleigh') {
      const d0 = read.num('delta0');
      const alpha = read.num('alpha');
      const f = fractionation(d0, alpha, read.num('f'));
      const vars = { rayleigh: fmt(f.rayleigh, 6), batch: fmt(f.batch, 6), product: fmt(f.product, 6) };
      const curve = (open: boolean) =>
        Array.from({ length: 50 }, (_, k) => {
          const ff = 1 - k / 50;
          const v = fractionation(d0, alpha, ff);
          return [ff, open ? v.rayleigh : v.batch] as const;
        });
      return {
        answer: t('kitEarth.dating.a.rayleigh', vars),
        latex: `\\delta = (\\delta_0 + 1000) f^{\\alpha - 1} - 1000 = ${tex(f.rayleigh)}`,
        rows: [
          [r('rayleigh'), `${vars.rayleigh}‰`],
          [r('batch'), `${vars.batch}‰`],
          [r('product'), `${vars.product}‰`],
        ],
        steps: [t('kitEarth.dating.s.rayleigh', vars), t('kitEarth.dating.s.batch', vars)],
        figures: [
          linePlot({
            title: t('kitEarth.dating.plot.rayleighTitle'),
            description: t('kitEarth.dating.plot.rayleighText', { alpha: fmt(alpha) }),
            xLabel: t('kitEarth.dating.plot.f'),
            yLabel: t('kitEarth.dating.plot.delta'),
            series: [
              { points: curve(true), role: 's0', label: t('kitEarth.dating.plot.open') },
              { points: curve(false), role: 's1', label: t('kitEarth.dating.plot.closed'), dash: true },
            ],
          }),
        ],
      };
    }
    const members = numberRows(read.raw('members'), 3).map(([fraction, concentration, delta]) => ({
      fraction,
      concentration,
      delta,
    }));
    check(members.length <= 3, 'members');
    const m = mix(members);
    const vars = { delta: fmt(m.delta, 6), c: fmt(m.concentration, 6) };
    return {
      answer: t('kitEarth.dating.a.mix', vars),
      latex: `\\delta_{mix} = \\frac{\\sum f_i C_i \\delta_i}{\\sum f_i C_i} = ${tex(m.delta)}`,
      rows: [
        [r('mixDelta'), `${vars.delta}‰`],
        [r('mixC'), vars.c],
      ],
      steps: [t('kitEarth.dating.s.mix', vars)],
    };
  },
};

const MINERALS = {
  olivine: { oxygens: 4, ideal: 3 },
  pyroxene: { oxygens: 6, ideal: 4 },
  feldspar: { oxygens: 8, ideal: null },
  garnet: { oxygens: 12, ideal: 8 },
  spinel: { oxygens: 4, ideal: 3 },
  custom: { oxygens: 0, ideal: null },
} as const;

/** End-member fractions for the minerals that have a common set. */
function endMembers(mineral: string, c: Partial<Record<string, number>>): [string, number][] {
  const g = (k: string) => c[k] ?? 0;
  const share = (parts: [string, number][]) => {
    const sum = parts.reduce((s, [, v]) => s + v, 0);
    return sum > 0 ? parts.map(([k, v]): [string, number] => [k, (100 * v) / sum]) : [];
  };
  if (mineral === 'olivine')
    return share([
      ['fo', g('Mg')],
      ['fa', g('Fe')],
    ]);
  if (mineral === 'pyroxene')
    return share([
      ['wo', g('Ca')],
      ['en', g('Mg')],
      ['fs', g('Fe')],
    ]);
  if (mineral === 'feldspar')
    return share([
      ['an', g('Ca')],
      ['ab', g('Na')],
      ['or', g('K')],
    ]);
  if (mineral === 'garnet')
    return share([
      ['alm', g('Fe')],
      ['prp', g('Mg')],
      ['grs', g('Ca')],
      ['sps', g('Mn')],
    ]);
  return [];
}

const mineral: Mode = {
  id: 'mineral',
  label: 'kitEarth.dating.modes.mineral',
  intro: 'kitEarth.dating.intro.mineral',
  fields: [
    pick('mineral', Object.keys(MINERALS)),
    num('oxygens', '4', undefined, undefined, { show: when('mineral', 'custom') }),
    pick('charge', ['none', 'droop']),
    num('cations', '', undefined, undefined, {
      show: (text) => text('mineral') === 'custom' && text('charge') === 'droop',
      optional: true,
    }),
    ...OXIDE_NAMES.map((o) =>
      num(o, o === 'SiO2' ? '40.0' : o === 'MgO' ? '50.0' : o === 'FeO' ? '10.0' : '', undefined, undefined, {
        optional: true,
      }),
    ),
  ],
  solve(read) {
    const which = read.pick('mineral') as keyof typeof MINERALS;
    const preset = MINERALS[which];
    const oxygens = which === 'custom' ? read.num('oxygens') : preset.oxygens;
    const ideal = read.pick('charge') === 'none' ? null : which === 'custom' ? read.opt('cations') : preset.ideal;
    const analysis: Partial<Record<Oxide, number>> = {};
    for (const o of OXIDE_NAMES) {
      const v = read.opt(o);
      if (v !== null) analysis[o] = v;
    }
    const f = formula(analysis, oxygens, ideal);
    const members = endMembers(which, f.cations);
    const vars = { oxygens: fmt(oxygens), total: fmt(f.total, 5), sum: fmt(f.sum, 5) };
    return {
      answer: t('kitEarth.dating.a.mineral', vars),
      table: {
        header: [r('cation'), r('perFormula')],
        rows: Object.entries(f.cations).map(([k, v]) => [
          k === 'Fe3' ? 'Fe³⁺' : k === 'Fe' && f.fe3 > 0 ? 'Fe²⁺' : k,
          fmt(v ?? 0, 5),
        ]),
      },
      rows: [
        [r('total'), vars.total],
        [r('sum'), `${vars.sum} wt%`],
        ...(f.fe3 > 0 ? ([[r('fe3'), fmt(f.fe3, 5)]] as [string, string][]) : []),
        ...members.map(([k, v]): [string, string] => [word(`member.${k}`), `${fmt(v, 4)}%`]),
      ],
      steps: [
        t('kitEarth.dating.s.moles'),
        t('kitEarth.dating.s.oxygens', vars),
        ...(ideal !== null
          ? [t('kitEarth.dating.s.droop', { ideal: fmt(ideal), oxygens: vars.oxygens, fe3: fmt(f.fe3, 5) })]
          : []),
      ],
      source: t('kitEarth.dating.sources.atomic'),
    };
  },
};

const RANKS: readonly Rank[] = ['eon', 'era', 'period', 'epoch'];

const timescale: Mode = {
  id: 'timescale',
  label: 'kitEarth.dating.modes.timescale',
  intro: 'kitEarth.dating.intro.timescale',
  fields: [num('age', '100'), num('older', '541'), num('younger', '0'), pick('rank', RANKS)],
  solve(read) {
    const age = read.num('age');
    check(age >= 0 && age <= 4567, 'timeAge');
    const older = read.num('older');
    const younger = read.num('younger');
    check(older > younger && younger >= 0 && older <= 4567, 'span');
    const found = lookup(age);
    const rank = read.pick('rank') as Rank;
    const list = within(rank, older, younger);
    const names = found.map((x) => word(`div.${x.id}`));
    const w = 520;
    const sx = (ma: number) => 10 + ((older - ma) / (older - younger)) * (w - 20);
    const marks: Mark[] = [];
    RANKS.forEach((rk, row) => {
      for (const d of within(rk, older, younger)) {
        const x = sx(d.start);
        const width = sx(d.end) - x;
        const role = (['s0', 's1', 's2', 's3'] as const)[row];
        marks.push({ kind: 'rect', x, y: 10 + row * 34, w: width, h: 28, role, fill: true, opacity: 0.18 });
        marks.push({ kind: 'rect', x, y: 10 + row * 34, w: width, h: 28, role: 'axis', width: 0.8 });
        if (width > 6 + 5.2 * word(`div.${d.id}`).length)
          marks.push({
            kind: 'text',
            x: x + width / 2,
            y: 28 + row * 34,
            text: word(`div.${d.id}`),
            role: 'text',
            size: 9,
            anchor: 'middle',
          });
      }
    });
    if (age <= older && age >= younger)
      marks.push({ kind: 'line', x1: sx(age), y1: 4, x2: sx(age), y2: 150, role: 'text', width: 1.5, dash: true });
    marks.push({ kind: 'text', x: 10, y: 166, text: `${fmt(older)} Ma`, role: 'muted', size: 9 });
    marks.push({ kind: 'text', x: w - 10, y: 166, text: `${fmt(younger)} Ma`, role: 'muted', size: 9, anchor: 'end' });
    return {
      answer: t('kitEarth.dating.a.timescale', { age: fmt(age), names: names.join(', ') }),
      rows: found.map((x): [string, string] => [
        word(`rank.${x.rank}`),
        `${word(`div.${x.id}`)} (${fmt(x.start)}–${fmt(x.end)} Ma)`,
      ]),
      table: {
        header: [r('name'), r('rank'), r('start'), r('end')],
        rows: list.map((x) => {
          const whole = DIVISIONS.find((d) => d.id === x.id)!;
          return [word(`div.${x.id}`), word(`rank.${x.rank}`), fmt(whole.start), fmt(whole.end)];
        }),
      },
      steps: [t('kitEarth.dating.s.lookup'), t('kitEarth.dating.s.timeline')],
      figures: [
        {
          width: w,
          height: 172,
          title: t('kitEarth.dating.plot.timeTitle'),
          description: t('kitEarth.dating.plot.timeText', { older: fmt(older), younger: fmt(younger), age: fmt(age) }),
          marks,
        },
      ],
      source: t('kitEarth.dating.sources.timescale'),
    };
  },
};

export const DATING_MODES: readonly Mode[] = [
  ratioMode,
  isochron,
  upb,
  kar,
  plateauMode,
  carbon,
  isotopes,
  mineral,
  timescale,
];
