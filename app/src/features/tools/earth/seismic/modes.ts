// The seismology calculations as forms: S-P distance, the Wadati diagram, an epicenter from arrivals, magnitude
// and energy, the b-value, refraction from a model or from picks, reflection moveout, Dix speeds, and wave speeds.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import type { Mark } from '../core/figure';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor, when } from '../ui/fields';
import type { Mode } from '../ui/form';
import {
  bValue,
  cumulative,
  dix,
  fromPicks,
  locate,
  magnitude,
  moment,
  momentOf,
  nmo,
  refraction,
  spDistance,
  wadati,
  waveSpeeds,
} from './engine';

const { num, pick, text, r } = fieldsFor('seismic');

const sp: Mode = {
  id: 'sp',
  label: 'kitEarth.seismic.modes.sp',
  fields: [num('dt', '10', 'time'), num('vp', '6', 'velocity'), num('vs', '3.5', 'velocity')],
  solve(read) {
    const vp = read.num('vp');
    const vs = read.num('vs');
    const d = spDistance(read.num('dt'), vp, vs);
    const vars = { value: fmt(d / 1000) };
    return {
      answer: t('kitEarth.seismic.a.sp', vars),
      latex: `d = \\frac{\\Delta t}{1/V_s - 1/V_p} = ${tex(d / 1000)}\\ \\mathrm{km}`,
      rows: [
        [r('distance'), `${fmt(d / 1000)} km`],
        [r('ratio'), fmt(vp / vs, 4)],
        [r('tp'), `${fmt(d / vp)} s`],
      ],
      steps: [t('kitEarth.seismic.s.sp', { dt: fmt(read.num('dt')), vp: fmt(vp / 1000), vs: fmt(vs / 1000), ...vars })],
    };
  },
};

const wadatiMode: Mode = {
  id: 'wadati',
  label: 'kitEarth.seismic.modes.wadati',
  intro: 'kitEarth.seismic.intro.wadati',
  fields: [text('arrivals', '5.33, 7.83\n10.33, 14.83\n17, 24.17\n25.33, 35.83')],
  solve(read) {
    const rows = numberRows(read.raw('arrivals'), 2);
    check(rows.length >= 2, 'points', { count: 2 });
    const w = wadati(rows.map(([a, b]) => [a, b] as const));
    const tps = rows.map((row) => row[0]);
    const lo = Math.min(w.origin, ...tps);
    const hi = Math.max(...tps);
    const vars = { ratio: fmt(w.ratio, 4), origin: fmt(w.origin, 4) };
    return {
      answer: t('kitEarth.seismic.a.wadati', vars),
      latex: `t_S - t_P = (V_p/V_s - 1)(t_P - t_0),\\quad V_p/V_s = ${tex(w.ratio, 4)}`,
      rows: [
        [r('ratio'), fmt(w.ratio, 4)],
        [r('origin'), `${fmt(w.origin, 4)} s`],
        [r('slope'), fmt(w.line.slope, 4)],
      ],
      steps: [
        t('kitEarth.seismic.s.wadatiFit', { slope: fmt(w.line.slope, 4), intercept: fmt(w.line.intercept, 4) }),
        t('kitEarth.seismic.s.wadati', vars),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.seismic.plot.wadatiTitle'),
          description: t('kitEarth.seismic.plot.wadatiText', { count: rows.length, ...vars }),
          xLabel: t('kitEarth.seismic.plot.tp'),
          yLabel: t('kitEarth.seismic.plot.sp'),
          series: [
            { points: rows.map(([a, b]) => [a, b - a] as const), dots: true, role: 's0' },
            {
              points: [
                [lo, w.line.intercept + w.line.slope * lo],
                [hi, w.line.intercept + w.line.slope * hi],
              ],
              role: 's1',
              label: t('kitEarth.seismic.plot.fit'),
            },
          ],
        }),
      ],
    };
  },
};

const locateMode: Mode = {
  id: 'locate',
  label: 'kitEarth.seismic.modes.locate',
  intro: 'kitEarth.seismic.intro.locate',
  fields: [
    text('stations', 'A, 0, 0, 8.727\nB, 50, 0, 12.073\nC, 0, 50, 8.003\nD, 40, 40, 11.009'),
    num('vp', '6', 'velocity'),
  ],
  solve(read) {
    const lines = read
      .raw('stations')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    const named = lines.map((line, i) => {
      const cells = line.split(/\s*[,;\t]\s*|\s+/);
      const name = Number.isNaN(Number(cells[0])) ? cells.shift()! : String.fromCharCode(65 + (i % 26));
      return { name, cells };
    });
    const rows = numberRows(named.map((n) => n.cells.join(', ')).join('\n'), 3);
    const stations = rows.map(([x, y, tt]) => ({ x: x * 1000, y: y * 1000, t: tt }));
    const v = read.num('vp');
    const loc = locate(stations, v);
    const vars = { x: fmt(loc.x / 1000, 4), y: fmt(loc.y / 1000, 4), origin: fmt(loc.origin, 4) };
    const circle = (cx: number, cy: number, radius: number) =>
      Array.from({ length: 73 }, (_, k) => {
        const a = (k / 72) * 2 * Math.PI;
        return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
      });
    const all = stations.map((s) => [s.x / 1000, s.y / 1000] as const);
    const xs = [...all.map((p) => p[0]), loc.x / 1000];
    const ys = [...all.map((p) => p[1]), loc.y / 1000];
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1) * 0.65;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const labels = (sx: (x: number) => number, sy: (y: number) => number): Mark[] =>
      named.map((n, i) => ({
        kind: 'text',
        x: sx(all[i][0]) + 5,
        y: sy(all[i][1]) - 5,
        text: n.name,
        role: 'text',
        size: 10,
      }));
    return {
      answer: t('kitEarth.seismic.a.locate', vars),
      latex: `\\min \\sum_i \\left(t_i - t_0 - \\frac{\\sqrt{(x_i - x)^2 + (y_i - y)^2}}{V}\\right)^2`,
      rows: [
        [r('x'), `${fmt(loc.x / 1000, 4)} km`],
        [r('y'), `${fmt(loc.y / 1000, 4)} km`],
        [r('origin'), `${fmt(loc.origin, 4)} s`],
        [r('rms'), `${fmt(loc.rms, 3)} s`],
      ],
      table: {
        header: [r('station'), r('distance'), r('residual')],
        rows: named.map((n, i) => [n.name, `${fmt(loc.distances[i] / 1000, 4)} km`, `${fmt(loc.residuals[i], 3)} s`]),
      },
      steps: [
        t('kitEarth.seismic.s.locateStart', { count: stations.length }),
        t('kitEarth.seismic.s.locate', { iterations: loc.iterations, ...vars, rms: fmt(loc.rms, 3) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.seismic.plot.mapTitle'),
          description: t('kitEarth.seismic.plot.mapText', { count: stations.length, ...vars }),
          xLabel: t('kitEarth.seismic.plot.east'),
          yLabel: t('kitEarth.seismic.plot.north'),
          x: [cx - span, cx + span],
          y: [cy - span, cy + span],
          width: 320,
          height: 320,
          series: [
            ...stations.map((s, i) => ({
              points: circle(s.x / 1000, s.y / 1000, loc.distances[i] / 1000),
              role: 'grid' as const,
              dash: true,
            })),
            { points: all, dots: true, role: 's1', label: t('kitEarth.seismic.plot.stations') },
            {
              points: [[loc.x / 1000, loc.y / 1000]],
              dots: true,
              role: 's0',
              label: t('kitEarth.seismic.plot.epicenter'),
            },
          ],
          extra: labels,
        }),
      ],
    };
  },
};

const magnitudeMode: Mode = {
  id: 'magnitude',
  label: 'kitEarth.seismic.modes.magnitude',
  fields: [
    pick('given', ['moment', 'fault']),
    num('m0', '1e20', 'moment', undefined, { show: when('given', 'moment') }),
    num('rigidity', '30', 'modulus', 'GPa', { show: when('given', 'fault') }),
    num('area', '1000', 'area', 'km²', { show: when('given', 'fault') }),
    num('slip', '2', 'length', 'm', { show: when('given', 'fault') }),
  ],
  solve(read) {
    const fault = read.pick('given') === 'fault';
    const m0 = fault ? moment(read.num('rigidity'), read.num('area'), read.num('slip')) : read.num('m0');
    const m = magnitude(m0);
    const vars = { mw: fmt(m.mw, 6), energy: fmt(m.logEnergy, 6) };
    const levels = [3, 4, 5, 6, 7, 8, 9];
    return {
      answer: t('kitEarth.seismic.a.magnitude', vars),
      latex: `M_w = \\tfrac{2}{3}(\\log_{10} M_0 - 9.1) = ${tex(m.mw)},\\quad \\log_{10} E = 1.5 M_w + 4.8 = ${tex(m.logEnergy)}`,
      rows: [
        [r('m0'), `${fmt(m0)} N·m`],
        [r('mw'), fmt(m.mw, 6)],
        [r('logEnergy'), fmt(m.logEnergy, 6)],
        [r('energy'), `${fmt(10 ** m.logEnergy, 4)} J`],
      ],
      table: {
        header: [r('mw'), r('m0'), r('energy'), r('times')],
        rows: levels.map((level) => [
          String(level),
          `${fmt(momentOf(level), 3)} N·m`,
          `${fmt(10 ** (1.5 * level + 4.8), 3)} J`,
          fmt(10 ** (1.5 * (level - m.mw)), 3),
        ]),
      },
      steps: [
        ...(fault
          ? [
              t('kitEarth.seismic.s.moment', {
                rigidity: fmt(read.num('rigidity')),
                area: fmt(read.num('area')),
                slip: fmt(read.num('slip')),
                value: fmt(m0),
              }),
            ]
          : []),
        t('kitEarth.seismic.s.mw', { m0: fmt(m0), ...vars }),
        t('kitEarth.seismic.s.energy', vars),
      ],
    };
  },
};

const bMode: Mode = {
  id: 'bvalue',
  label: 'kitEarth.seismic.modes.bvalue',
  intro: 'kitEarth.seismic.intro.bvalue',
  fields: [text('magnitudes', '2.0, 2.1, 2.3, 2.5, 2.2, 3.0, 2.4, 2.8, 2.0, 2.6'), num('mc', '2.0'), num('bin', '0.1')],
  solve(read) {
    const mags = read
      .raw('magnitudes')
      .split(/[\s,;]+/)
      .filter((cell) => cell !== '')
      .map(Number);
    check(mags.every(Number.isFinite), 'magnitudeNumber');
    const mc = read.num('mc');
    const bin = read.num('bin');
    const b = bValue(mags, mc, bin);
    const counts = cumulative(mags, mc, bin);
    const vars = { b: fmt(b.b, 6), se: fmt(b.se, 3), a: fmt(b.a, 4), count: b.count };
    const top = Math.max(...mags);
    return {
      answer: t('kitEarth.seismic.a.bvalue', vars),
      latex: `b = \\frac{\\log_{10} e}{\\bar M - (M_c - \\Delta M/2)} = ${tex(b.b)}`,
      rows: [
        [r('b'), fmt(b.b, 6)],
        [r('se'), fmt(b.se, 3)],
        [r('seAki'), fmt(b.seAki, 3)],
        [r('a'), fmt(b.a, 4)],
        [r('count'), String(b.count)],
        [r('below'), String(b.below)],
      ],
      steps: [
        t('kitEarth.seismic.s.mean', { count: b.count, mean: fmt(b.mean, 6), below: b.below }),
        t('kitEarth.seismic.s.b', { mean: fmt(b.mean, 6), mc: fmt(mc), bin: fmt(bin), b: fmt(b.b, 6) }),
        t('kitEarth.seismic.s.se', { se: fmt(b.se, 3), aki: fmt(b.seAki, 3) }),
        t('kitEarth.seismic.s.a', { a: fmt(b.a, 4), count: b.count, b: fmt(b.b, 6), mc: fmt(mc) }),
      ],
      figures: [
        linePlot({
          title: t('kitEarth.seismic.plot.grTitle'),
          description: t('kitEarth.seismic.plot.grText', vars),
          xLabel: t('kitEarth.seismic.plot.magnitude'),
          yLabel: t('kitEarth.seismic.plot.count'),
          logY: true,
          series: [
            { points: counts, dots: true, role: 's0' },
            {
              points: [
                [mc, 10 ** (b.a - b.b * mc)],
                [top, 10 ** (b.a - b.b * top)],
              ],
              role: 's1',
              label: t('kitEarth.seismic.plot.fit'),
            },
          ],
        }),
      ],
    };
  },
};

function travelPlot(
  v1: number,
  v2: number,
  ti: number,
  crossover: number,
  critical: number,
  picks: readonly (readonly number[])[] = [],
) {
  const end = Math.max(crossover * 2.5, critical * 3, ...picks.map((p) => p[0]));
  return linePlot({
    title: t('kitEarth.seismic.plot.refractionTitle'),
    description: t('kitEarth.seismic.plot.refractionText', {
      crossover: fmt(crossover, 4),
      intercept: fmt(ti * 1000, 4),
    }),
    xLabel: t('kitEarth.seismic.plot.offset'),
    yLabel: t('kitEarth.seismic.plot.time'),
    series: [
      {
        points: [
          [0, 0],
          [end, (end / v1) * 1000],
        ],
        role: 's0',
        label: t('kitEarth.seismic.plot.direct'),
      },
      {
        points: [
          [critical, (ti + critical / v2) * 1000],
          [end, (ti + end / v2) * 1000],
        ],
        role: 's1',
        label: t('kitEarth.seismic.plot.head'),
      },
      ...(picks.length
        ? [{ points: picks.map((p) => [p[0], p[1] * 1000] as const), dots: true, role: 'text' as const }]
        : []),
    ],
    vlines: [{ x: crossover, label: t('kitEarth.seismic.plot.crossover') }],
  });
}

const refractionMode: Mode = {
  id: 'refraction',
  label: 'kitEarth.seismic.modes.refraction',
  fields: [num('v1', '1500', 'velocity', 'm/s'), num('v2', '4000', 'velocity', 'm/s'), num('h', '20', 'length', 'm')],
  solve(read) {
    const v1 = read.num('v1');
    const v2 = read.num('v2');
    const h = read.num('h');
    const ref = refraction(v1, v2, h);
    const vars = {
      crossover: fmt(ref.crossover),
      intercept: fmt(ref.intercept),
      critical: fmt(ref.critical),
      angle: fmt(ref.angle, 4),
    };
    return {
      answer: t('kitEarth.seismic.a.refraction', vars),
      latex: `x_c = 2h\\sqrt{\\frac{V_2 + V_1}{V_2 - V_1}} = ${tex(ref.crossover)}\\ \\mathrm{m}`,
      rows: [
        [r('crossover'), `${fmt(ref.crossover)} m`],
        [r('intercept'), `${fmt(ref.intercept)} s`],
        [r('critical'), `${fmt(ref.critical)} m`],
        [r('angle'), `${fmt(ref.angle, 4)}°`],
      ],
      steps: [
        t('kitEarth.seismic.s.angle', { v1: fmt(v1), v2: fmt(v2), angle: vars.angle }),
        t('kitEarth.seismic.s.crossover', { h: fmt(h), v1: fmt(v1), v2: fmt(v2), value: vars.crossover }),
        t('kitEarth.seismic.s.intercept', { value: vars.intercept }),
        t('kitEarth.seismic.s.critical', { value: vars.critical }),
      ],
      figures: [travelPlot(v1, v2, ref.intercept, ref.crossover, ref.critical)],
    };
  },
};

const picksMode: Mode = {
  id: 'picks',
  label: 'kitEarth.seismic.modes.picks',
  intro: 'kitEarth.seismic.intro.picks',
  fields: [
    text('picks', '5, 0.00333, 1\n10, 0.00667, 1\n20, 0.01333, 1\n60, 0.03972, 2\n80, 0.04472, 2\n100, 0.04972, 2'),
  ],
  solve(read) {
    const rows = numberRows(read.raw('picks'), 3);
    for (const row of rows) check(row[2] === 1 || row[2] === 2, 'branch');
    const p = fromPicks(rows.map(([x, tt, b]) => [x, tt, b] as const));
    const ref = refraction(p.v1, p.v2, p.depth);
    const vars = { v1: fmt(p.v1, 5), v2: fmt(p.v2, 5), depth: fmt(p.depth, 5) };
    return {
      answer: t('kitEarth.seismic.a.picks', vars),
      latex: `h = \\frac{t_i V_1 V_2}{2\\sqrt{V_2^2 - V_1^2}} = ${tex(p.depth)}\\ \\mathrm{m}`,
      rows: [
        [r('v1'), `${fmt(p.v1, 5)} m/s`],
        [r('v2'), `${fmt(p.v2, 5)} m/s`],
        [r('intercept'), `${fmt(p.intercept)} s`],
        [r('depth'), `${fmt(p.depth, 5)} m`],
      ],
      steps: [
        t('kitEarth.seismic.s.direct', { slope: fmt(p.direct.slope), v1: vars.v1 }),
        t('kitEarth.seismic.s.head', { slope: fmt(p.head.slope), intercept: fmt(p.intercept), v2: vars.v2 }),
        t('kitEarth.seismic.s.depth', { intercept: fmt(p.intercept), ...vars }),
      ],
      figures: [travelPlot(p.v1, p.v2, p.intercept, ref.crossover, ref.critical, rows)],
    };
  },
};

const nmoMode: Mode = {
  id: 'nmo',
  label: 'kitEarth.seismic.modes.nmo',
  fields: [num('t0', '1', 'time'), num('offset', '1000', 'length', 'm'), num('v', '2000', 'velocity', 'm/s')],
  solve(read) {
    const t0 = read.num('t0');
    const v = read.num('v');
    const x = read.num('offset');
    const out = nmo(t0, x, v);
    const vars = { t: fmt(out.t), moveout: fmt(out.moveout) };
    const far = Math.max(x * 1.5, 1);
    const curve = Array.from({ length: 41 }, (_, k) => {
      const at = -far + (2 * far * k) / 40;
      return [at, nmo(t0, at, v).t] as const;
    });
    return {
      answer: t('kitEarth.seismic.a.nmo', vars),
      latex: `t(x) = \\sqrt{t_0^2 + x^2/V^2} = ${tex(out.t)}\\ \\mathrm{s}`,
      rows: [
        [r('t'), `${fmt(out.t)} s`],
        [r('moveout'), `${fmt(out.moveout)} s`],
        [r('depth'), `${fmt((v * t0) / 2)} m`],
      ],
      steps: [t('kitEarth.seismic.s.nmo', { t0: fmt(t0), x: fmt(x), v: fmt(v), ...vars })],
      figures: [
        linePlot({
          title: t('kitEarth.seismic.plot.nmoTitle'),
          description: t('kitEarth.seismic.plot.nmoText', { t0: fmt(t0), v: fmt(v) }),
          xLabel: t('kitEarth.seismic.plot.offset'),
          yLabel: t('kitEarth.seismic.plot.twoWay'),
          flipY: true,
          series: [{ points: curve, role: 's0' }],
          vlines: [{ x }],
        }),
      ],
    };
  },
};

const dixMode: Mode = {
  id: 'dix',
  label: 'kitEarth.seismic.modes.dix',
  fields: [
    num('t1', '1', 'time'),
    num('vrms1', '2000', 'velocity', 'm/s'),
    num('t2', '1.5', 'time'),
    num('vrms2', '2500', 'velocity', 'm/s'),
  ],
  solve(read) {
    const t1 = read.num('t1');
    const t2 = read.num('t2');
    const v1 = read.num('vrms1');
    const v2 = read.num('vrms2');
    const d = dix(t1, v1, t2, v2);
    const vars = { speed: fmt(d.speed), thickness: fmt(d.thickness) };
    return {
      answer: t('kitEarth.seismic.a.dix', vars),
      latex: `V_{int} = \\sqrt{\\frac{V_2^2 t_2 - V_1^2 t_1}{t_2 - t_1}} = ${tex(d.speed)}\\ \\mathrm{m/s}`,
      rows: [
        [r('interval'), `${fmt(d.speed)} m/s`],
        [r('thickness'), `${fmt(d.thickness)} m`],
      ],
      steps: [
        t('kitEarth.seismic.s.dix', { t1: fmt(t1), t2: fmt(t2), v1: fmt(v1), v2: fmt(v2), ...vars }),
        t('kitEarth.seismic.s.dixThickness', vars),
      ],
    };
  },
};

const speeds: Mode = {
  id: 'speeds',
  label: 'kitEarth.seismic.modes.speeds',
  fields: [
    num('bulk', '50', 'modulus', 'GPa'),
    num('shear', '30', 'modulus', 'GPa'),
    num('density', '2700', 'density'),
  ],
  solve(read) {
    const w = waveSpeeds(read.num('bulk'), read.num('shear'), read.num('density'));
    const vars = { vp: fmt(w.vp / 1000, 5), vs: fmt(w.vs / 1000, 5) };
    return {
      answer: t('kitEarth.seismic.a.speeds', vars),
      latex: `V_p = \\sqrt{\\frac{K + \\tfrac43\\mu}{\\rho}},\\ V_s = \\sqrt{\\frac{\\mu}{\\rho}}`,
      rows: [
        [r('vp'), `${vars.vp} km/s`],
        [r('vs'), `${vars.vs} km/s`],
        [r('ratio'), Number.isFinite(w.ratio) ? fmt(w.ratio, 5) : '∞'],
        [r('poisson'), fmt(w.poisson, 4)],
      ],
      steps: [t('kitEarth.seismic.s.vp', { value: vars.vp }), t('kitEarth.seismic.s.vs', { value: vars.vs })],
    };
  },
};

export const SEISMIC_MODES: readonly Mode[] = [
  sp,
  wadatiMode,
  locateMode,
  magnitudeMode,
  bMode,
  refractionMode,
  picksMode,
  nmoMode,
  dixMode,
  speeds,
];
