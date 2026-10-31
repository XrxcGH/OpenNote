// The seawater calculations: EOS-80 and TEOS-10 properties of one sample, Mackenzie's sound speed, and a T–S diagram with
// isopycnals for pasted samples.
import { t } from '../../../../strings/t';
import { fmt, tex } from '../core/format';
import type { Mark } from '../core/figure';
import { linePlot } from '../core/plot';
import { check } from '../core/problem';
import { numberRows } from '../core/rows';
import { fieldsFor } from '../ui/fields';
import type { Mode } from '../ui/form';
import {
  SOURCES,
  absoluteSalinity,
  density,
  freezingPoint,
  isopycnalTemperature,
  mackenzie,
  potentialTemperature,
  sigmaTheta,
  soundSpeed,
  SPECVOL_TERMS,
  TEOS10_SOURCE,
  teosSample,
  toT68,
} from './engine';

const { num, pick, text, r } = fieldsFor('ocean');

/** A field temperature (K from the Reader) as IPTS-68 °C, converting from ITS-90 unless the person says otherwise. */
const t68 = (kelvin: number, scale: string) => (scale === 'ipts68' ? kelvin - 273.15 : toT68(kelvin - 273.15));

const sample: Mode = {
  id: 'seawater',
  label: 'kitEarth.ocean.modes.seawater',
  intro: 'kitEarth.ocean.intro.seawater',
  fields: [
    num('salinity', '35'),
    num('temperature', '5', 'temperature'),
    num('pressure', '0', 'seaPressure', 'dbar'),
    pick('scale', ['its90', 'ipts68']),
  ],
  solve(read) {
    const s = read.num('salinity');
    const tt = t68(read.num('temperature'), read.pick('scale'));
    const p = read.num('pressure') / 1e4;
    const rho = density(s, tt, p);
    const theta = potentialTemperature(s, tt, p);
    const sigma = sigmaTheta(s, theta);
    const c = soundSpeed(s, tt, p);
    const freeze = s >= 4 ? freezingPoint(s, p) : null;
    const rows: [string, string][] = [
      [r('density'), `${fmt(rho, 9)} kg/m³`],
      [r('theta'), `${fmt(theta, 7)} °C`],
      [r('sigmaTheta'), `${fmt(sigma, 7)} kg/m³`],
      [r('sound'), `${fmt(c, 7)} m/s`],
    ];
    if (freeze !== null) rows.push([r('freezing'), `${fmt(freeze, 6)} °C`]);
    rows.push([r('absolute'), `${fmt(absoluteSalinity(s), 6)} g/kg`]);
    return {
      answer: t('kitEarth.ocean.a.density', { value: fmt(rho, 9) }),
      latex: `\\rho(S,T,p) = \\frac{\\rho(S,T,0)}{1 - p/K(S,T,p)} = ${tex(rho, 9)}\\ \\mathrm{kg/m^3}`,
      rows,
      steps: [
        t('kitEarth.ocean.s.t68', { value: fmt(tt, 7) }),
        t('kitEarth.ocean.s.density', { value: fmt(rho, 9) }),
        t('kitEarth.ocean.s.theta', { value: fmt(theta, 7), sigma: fmt(sigma, 7) }),
        t('kitEarth.ocean.s.sound', { value: fmt(c, 7) }),
        t('kitEarth.ocean.s.absolute'),
      ],
      source: SOURCES.eos80,
    };
  },
};

const teos: Mode = {
  id: 'teos10',
  label: 'kitEarth.ocean.modes.teos10',
  intro: 'kitEarth.ocean.intro.teos10',
  fields: [
    num('salinity', '35'),
    num('temperature', '5', 'temperature'),
    num('pressure', '0', 'seaPressure', 'dbar'),
    pick('air', ['airFree', 'saturated']),
  ],
  solve(read) {
    const saturated = read.pick('air') === 'saturated';
    const x = teosSample(
      read.num('salinity'),
      read.num('temperature') - 273.15,
      read.num('pressure') / 1e4,
      saturated ? 1 : 0,
    );
    const air = t(saturated ? 'kitEarth.ocean.o.saturated' : 'kitEarth.ocean.o.airFree');
    return {
      answer: t('kitEarth.ocean.a.teos10', { value: fmt(x.rho, 9), ct: fmt(x.ct, 7) }),
      latex: `\\rho = \\frac{1}{v(S_A, \\Theta, p)} = ${tex(x.rho, 9)}\\ \\mathrm{kg/m^3}`,
      rows: [
        [r('absolute'), `${fmt(x.sa, 7)} g/kg`],
        [r('theta'), `${fmt(x.pt, 7)} °C`],
        [r('ct'), `${fmt(x.ct, 7)} °C`],
        [r('specvol'), `${fmt(x.v, 9)} m³/kg`],
        [r('density'), `${fmt(x.rho, 9)} kg/m³`],
        [r('sigma0'), `${fmt(x.sigma0, 7)} kg/m³`],
        [r('ctFreeze'), `${fmt(x.ctFreeze, 6)} °C`],
        [r('ptFreeze'), `${fmt(x.ptFreeze, 6)} °C`],
      ],
      steps: [
        t('kitEarth.ocean.s.teosSa', { value: fmt(x.sa, 7) }),
        t('kitEarth.ocean.s.teosPt', { value: fmt(x.pt, 7) }),
        t('kitEarth.ocean.s.teosCt', { value: fmt(x.ct, 7) }),
        t('kitEarth.ocean.s.teosRho', { terms: SPECVOL_TERMS, v: fmt(x.v, 9), value: fmt(x.rho, 9) }),
        t('kitEarth.ocean.s.teosSigma', { value: fmt(x.sigma0, 7) }),
        t('kitEarth.ocean.s.teosFreeze', { air, ct: fmt(x.ctFreeze, 6), pt: fmt(x.ptFreeze, 6) }),
      ],
      source: TEOS10_SOURCE,
    };
  },
};

const sound: Mode = {
  id: 'mackenzie',
  label: 'kitEarth.ocean.modes.mackenzie',
  fields: [num('temperature', '10', 'temperature'), num('salinity', '35'), num('depthM', '1000', 'depth')],
  solve(read) {
    const c = mackenzie(read.num('temperature') - 273.15, read.num('salinity'), read.num('depthM'));
    return {
      answer: t('kitEarth.ocean.a.sound', { value: fmt(c, 7) }),
      latex: `c = 1448.96 + 4.591T - 5.304\\times10^{-2}T^2 + \\dots = ${tex(c, 7)}\\ \\mathrm{m/s}`,
      rows: [[r('sound'), `${fmt(c, 7)} m/s`]],
      steps: [t('kitEarth.ocean.s.mackenzie', { value: fmt(c, 7) })],
      source: SOURCES.mackenzie,
    };
  },
};

function isopycnals(sRange: readonly [number, number], tRange: readonly [number, number]) {
  const levels: { sigma: number; points: [number, number][] }[] = [];
  const corners = [sRange[0], sRange[1]].flatMap((s) => [tRange[0], tRange[1]].map((tt) => sigmaTheta(s, tt)));
  const [lo, hi] = [Math.ceil(Math.min(...corners) * 2) / 2, Math.floor(Math.max(...corners) * 2) / 2];
  const step = hi - lo > 6 ? 1 : 0.5;
  for (let sigma = lo; sigma <= hi + 1e-9; sigma += step) {
    const points: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const s = sRange[0] + ((sRange[1] - sRange[0]) * i) / 40;
      const tt = isopycnalTemperature(s, sigma);
      if (tt !== null && tt >= tRange[0] && tt <= tRange[1]) points.push([s, tt]);
    }
    if (points.length > 1) levels.push({ sigma, points });
  }
  return levels;
}

const ts: Mode = {
  id: 'ts',
  label: 'kitEarth.ocean.modes.ts',
  intro: 'kitEarth.ocean.intro.ts',
  fields: [text('samples', '34.2, 18\n34.6, 12\n34.9, 6\n34.7, 3\n34.9, 2')],
  solve(read) {
    const rows = numberRows(read.raw('samples'), 2);
    check(rows.length > 0, 'rowsNone');
    for (const [s, tt] of rows) check(s >= 0 && s <= 42 && tt >= -2 && tt <= 40, 'sample');
    const sigmas = rows.map(([s, tt]) => sigmaTheta(s, tt));
    const ss = rows.map((row) => row[0]);
    const tts = rows.map((row) => row[1]);
    const sRange = [Math.min(...ss) - 0.2, Math.max(...ss) + 0.2] as const;
    const tRange = [Math.max(-2, Math.min(...tts) - 1), Math.min(40, Math.max(...tts) + 1)] as const;
    const levels = isopycnals(sRange, tRange);
    const labels = (sx: (x: number) => number, sy: (y: number) => number): Mark[] =>
      levels.map((level) => {
        const [s, tt] = level.points[level.points.length - 1];
        return {
          kind: 'text',
          x: sx(s) - 2,
          y: sy(tt) - 3,
          text: fmt(level.sigma, 4),
          role: 'muted',
          anchor: 'end',
          size: 9,
        };
      });
    const figure = linePlot({
      title: t('kitEarth.ocean.plot.tsTitle'),
      description: t('kitEarth.ocean.plot.tsText', {
        count: rows.length,
        lo: fmt(Math.min(...sigmas), 4),
        hi: fmt(Math.max(...sigmas), 4),
      }),
      xLabel: t('kitEarth.ocean.plot.salinity'),
      yLabel: t('kitEarth.ocean.plot.temperature'),
      x: sRange,
      y: tRange,
      series: [
        ...levels.map((level) => ({ points: level.points, role: 'grid' as const, dash: true })),
        { points: rows.map(([s, tt]) => [s, tt] as const), role: 's0' as const },
        { points: rows.map(([s, tt]) => [s, tt] as const), role: 's0' as const, dots: true },
      ],
      extra: labels,
    });
    return {
      answer: t('kitEarth.ocean.a.ts', { count: rows.length }),
      table: {
        header: [t('kitEarth.ocean.r.salinity'), t('kitEarth.ocean.r.temperature'), t('kitEarth.ocean.r.sigmaTheta')],
        rows: rows.map(([s, tt], i) => [fmt(s), fmt(tt), fmt(sigmas[i], 6)]),
      },
      figures: [figure],
      steps: [t('kitEarth.ocean.s.ts')],
      source: SOURCES.eos80,
    };
  },
};

export const SEAWATER: readonly Mode[] = [sample, teos, sound, ts];
