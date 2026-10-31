// Two more seismology forms: refraction over a dipping interface shot from both ends (from a model or from the two
// shots' apparent speeds and intercepts), and the Omori-Utsu decay fitted to an aftershock sequence.
import '../text';
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import { dippingFromApparent, dippingRefraction } from './engine';
import type { Dipping } from './engine';
import { omoriCount, omoriRate, omoriUtsu } from './omori';

const { num, pick, text, r } = fieldsFor('seismic');

/** First arrivals along the spread from both shots: the direct waves and the two head waves, in ms. */
function dippingPlot(v1: number, d: Dipping, spread: number) {
  const ms = (v: number) => v * 1000;
  const down = (x: number) => d.interceptDown + x / d.down;
  const up = (x: number) => d.interceptUp + (spread - x) / d.up;
  return linePlot({
    title: t('kitEarth.seismic.plot.dipTitle'),
    description: t('kitEarth.seismic.plot.dipText', {
      reciprocal: fmt(ms(down(spread)), 4),
      down: fmt(d.down, 4),
      up: fmt(d.up, 4),
    }),
    xLabel: t('kitEarth.seismic.plot.alongSpread'),
    yLabel: t('kitEarth.seismic.plot.time'),
    series: [
      {
        points: [
          [0, 0],
          [spread, ms(spread / v1)],
        ],
        role: 's0',
        label: t('kitEarth.seismic.plot.direct'),
      },
      {
        points: [
          [0, ms(spread / v1)],
          [spread, 0],
        ],
        role: 's0',
        dash: true,
      },
      {
        points: [
          [0, ms(down(0))],
          [spread, ms(down(spread))],
        ],
        role: 's1',
        label: t('kitEarth.seismic.plot.headDown'),
      },
      {
        points: [
          [0, ms(up(0))],
          [spread, ms(up(spread))],
        ],
        role: 's2',
        label: t('kitEarth.seismic.plot.headUp'),
      },
    ],
    x: [0, spread],
    y: [0, ms(Math.max(spread / v1, down(spread), up(0)))],
  });
}

const dipping: Mode = {
  id: 'dipping',
  label: 'kitEarth.seismic.modes.dipping',
  intro: 'kitEarth.seismic.intro.dipping',
  fields: [
    pick('dipFrom', ['layerModel', 'apparent']),
    num('v1', '1500', 'velocity', 'm/s'),
    num('v2', '4000', 'velocity', 'm/s', { show: when('dipFrom', 'layerModel') }),
    num('hUp', '20', 'length', 'm', { show: when('dipFrom', 'layerModel') }),
    num('hDown', '30', 'length', 'm', { show: when('dipFrom', 'layerModel') }),
    num('vDown', '3564', 'velocity', 'm/s', { show: when('dipFrom', 'apparent') }),
    num('vUp', '4571', 'velocity', 'm/s', { show: when('dipFrom', 'apparent') }),
    num('tDown', '0.02472', 'time', 's', { show: when('dipFrom', 'apparent') }),
    num('tUp', '0.03708', 'time', 's', { show: when('dipFrom', 'apparent') }),
    num('spread', '200', 'length', 'm'),
  ],
  solve(read) {
    const v1 = read.num('v1');
    const spread = read.num('spread');
    const model = read.pick('dipFrom') === 'layerModel';
    const d = model
      ? dippingRefraction(v1, read.num('v2'), read.num('hUp'), read.num('hDown'), spread)
      : dippingFromApparent(v1, read.num('vDown'), read.num('vUp'), read.num('tDown'), read.num('tUp'));
    const vars = {
      down: fmt(d.down, 5),
      up: fmt(d.up, 5),
      dip: fmt(d.dip, 4),
      critical: fmt(d.critical, 4),
      v2: fmt(d.v2, 5),
      approx: fmt(d.v2Approx, 5),
      tDown: fmt(d.interceptDown * 1000, 4),
      tUp: fmt(d.interceptUp * 1000, 4),
      hUp: fmt(d.hUp, 4),
      hDown: fmt(d.hDown, 4),
      v1: fmt(v1),
    };
    return {
      answer: t(model ? 'kitEarth.seismic.a.dipModel' : 'kitEarth.seismic.a.dipApparent', vars),
      latex:
        `V_d = \\frac{V_1}{\\sin(\\theta_c + \\delta)} = ${tex(d.down)},\\quad ` +
        `V_u = \\frac{V_1}{\\sin(\\theta_c - \\delta)} = ${tex(d.up)}\\ \\mathrm{m/s}`,
      rows: [
        [r('vDown'), `${vars.down} m/s`],
        [r('vUp'), `${vars.up} m/s`],
        [r('tDown'), `${vars.tDown} ms`],
        [r('tUp'), `${vars.tUp} ms`],
        [r('dip'), `${vars.dip}°`],
        [r('angle'), `${vars.critical}°`],
        [r('v2'), `${vars.v2} m/s`],
        [r('v2Approx'), `${vars.approx} m/s`],
        [r('hUp'), `${vars.hUp} m`],
        [r('hDown'), `${vars.hDown} m`],
      ],
      steps: model
        ? [
            t('kitEarth.seismic.s.dipAngle', { ...vars, spread: fmt(spread) }),
            t('kitEarth.seismic.s.dipSpeeds', vars),
            t('kitEarth.seismic.s.dipIntercepts', vars),
          ]
        : [
            t('kitEarth.seismic.s.dipInvert', vars),
            t('kitEarth.seismic.s.dipDepths', vars),
            t('kitEarth.seismic.s.dipApprox', vars),
          ],
      figures: [dippingPlot(v1, d, spread)],
    };
  },
};

const OMORI_TIMES =
  '0.00386, 0.00805, 0.0126, 0.0176, 0.0229, 0.0288, 0.0352, 0.0421, 0.0497, 0.058, 0.067, 0.0769, 0.0877, ' +
  '0.0995, 0.112, 0.127, 0.142, 0.159, 0.178, 0.199, 0.221, 0.246, 0.274, 0.304, 0.338, 0.375, 0.416, 0.462, ' +
  '0.512, 0.568, 0.63, 0.699, 0.776, 0.862, 0.957, 1.06, 1.18, 1.32, 1.47, 1.63';

const omori: Mode = {
  id: 'omori',
  label: 'kitEarth.seismic.modes.omori',
  intro: 'kitEarth.seismic.intro.omori',
  fields: [text('aftershocks', OMORI_TIMES)],
  solve(read) {
    const times = read
      .raw('aftershocks')
      .split(/[\s,;]+/)
      .filter((cell) => cell !== '')
      .map(Number);
    check(times.every(Number.isFinite), 'aftershockNumber');
    const fit = omoriUtsu(times);
    const { k, c, p, se } = fit;
    const sorted = fit.times;
    const last = sorted[sorted.length - 1];
    const vars = {
      k: fmt(k, 4),
      c: fmt(c, 4),
      p: fmt(p, 4),
      sk: fmt(se[0], 2),
      sc: fmt(se[1], 2),
      sp: fmt(se[2], 2),
      count: sorted.length,
      last: fmt(last, 4),
      rate: fmt(omoriRate(1, k, c, p), 4),
      expected: fmt(omoriCount(last, k, c, p), 4),
    };
    // Observed rates in about 8 log-spaced bins between the first and last aftershock, as dots over the curve.
    const lo = Math.log10(sorted[0]);
    const span = Math.max(Math.log10(last) - lo, 1e-9);
    const bins = Math.min(8, Math.max(2, Math.floor(sorted.length / 4)));
    const edges = Array.from({ length: bins + 1 }, (_, i) => 10 ** (lo + (span * i) / bins));
    const observed = edges.slice(0, -1).flatMap((a, i) => {
      const b = edges[i + 1];
      const n = sorted.filter((v) => (i === 0 ? v >= a : v > a) && v <= b).length;
      return n > 0 ? [[Math.sqrt(a * b), n / (b - a)] as const] : [];
    });
    const curve = Array.from({ length: 61 }, (_, i) => {
      const tt = 10 ** (lo + (span * i) / 60);
      return [tt, omoriRate(tt, k, c, p)] as const;
    });
    return {
      answer: t('kitEarth.seismic.a.omori', vars),
      latex: `n(t) = \\frac{K}{(t + c)^p} = \\frac{${tex(k)}}{(t + ${tex(c)})^{${tex(p)}}}`,
      rows: [
        [r('k'), `${vars.k} ± ${vars.sk}`],
        [r('c'), `${vars.c} ± ${vars.sc}`],
        [r('p'), `${vars.p} ± ${vars.sp}`],
        [r('rate1'), vars.rate],
        [r('expected'), vars.expected],
      ],
      steps: [t('kitEarth.seismic.s.omoriCount', vars), t('kitEarth.seismic.s.omoriFit', vars)],
      figures: [
        linePlot({
          title: t('kitEarth.seismic.plot.omoriTitle'),
          description: t('kitEarth.seismic.plot.omoriText', vars),
          xLabel: t('kitEarth.seismic.plot.sinceMain'),
          yLabel: t('kitEarth.seismic.plot.rate'),
          logX: true,
          logY: true,
          series: [
            { points: observed, dots: true, role: 's0', label: t('kitEarth.seismic.plot.binned') },
            { points: curve, role: 's1', label: t('kitEarth.seismic.plot.omoriFit') },
          ],
        }),
      ],
    };
  },
};

export { dipping as dippingMode, omori as omoriMode };
