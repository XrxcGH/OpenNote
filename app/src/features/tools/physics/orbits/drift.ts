// The orbital mechanics tool's Earth-orbit calculations: a ground track, J2 drift with Sun-synchronous orbits, and
// eclipses in a cylindrical shadow.
import type { MessageKey } from '../../../../strings/t';
import { deg, fmt, q } from '../kit/format';
import type { KitStep, ModeDef, Outcome, Plot, PlotSeries, ResultRow } from '../kit/types';
import { EARTH, SUN_RATE, eclipseFraction, groundTrack, j2Rates, period, sunSynchronous } from './engine';
import { angle, angleRow, km } from './shared';

const K = 'kitPhysics.orbits';
const DAY = 86_400;
const degPerDay = (rate: number) => q(deg(rate) * DAY, '°/day', 6);
const rateRow = (key: MessageKey, symbol: string, value: number, primary = false): ResultRow => ({
  key,
  symbol,
  value,
  dim: 'angularRate',
  unit: 'deg/day',
  usUnit: 'deg/day',
  digits: 6,
  primary,
});

export const trackMode: ModeDef = {
  id: 'track',
  label: `${K}.modes.track`,
  fields: [
    { id: 'a', label: `${K}.f.a`, dim: 'length', unit: 'km', usUnit: 'mi', initial: '7078.137' },
    { id: 'e', label: `${K}.f.e`, initial: '0' },
    { id: 'i', label: `${K}.f.i`, dim: 'angle', initial: '51.6' },
    { id: 'raan', label: `${K}.f.raan`, dim: 'angle', initial: '0' },
    { id: 'argp', label: `${K}.f.argp`, dim: 'angle', initial: '0' },
    { id: 'nu', label: `${K}.f.nu`, dim: 'angle', initial: '0' },
    { id: 'orbits', label: `${K}.f.orbits`, initial: '3' },
    { id: 'theta', label: `${K}.f.greenwich`, dim: 'angle', initial: '0', help: `${K}.help.greenwich` },
    {
      id: 'j2',
      label: `${K}.f.j2`,
      kind: 'choice',
      initial: 'yes',
      options: [
        { value: 'yes', label: `${K}.o.yes` },
        { value: 'no', label: `${K}.o.no` },
      ],
    },
  ],
  solve(read): Outcome {
    const el = {
      a: read.num('a', 'positive'),
      e: read.num('e', { min: 0, max: 0.99 }),
      i: read.num('i', { min: 0, max: Math.PI }),
      raan: read.num('raan'),
      argp: read.num('argp'),
      nu: read.num('nu'),
    };
    if (el.a * (1 - el.e) <= EARTH.radius) return { ok: false, problem: { key: `${K}.errors.belowSurface` } };
    const orbits = read.num('orbits', { above: 0, max: 50 });
    const T = period(el.a, EARTH.mu);
    const withJ2 = read.choice('j2') === 'yes';
    const points = groundTrack(
      el,
      orbits * T,
      EARTH,
      read.num('theta'),
      withJ2,
      Math.min(4000, Math.ceil(240 * orbits)),
    );
    const shift = -deg(EARTH.rotation * T);
    const rates = j2Rates(el.a, el.e, el.i, EARTH);
    const nodalShift = withJ2 ? shift + deg(rates.raanRate * T) : shift;
    return {
      ok: true,
      rows: [
        { key: `${K}.r.shift`, symbol: 'Δλ', value: nodalShift, unit: '°', digits: 6, primary: true },
        { key: `${K}.r.period`, symbol: 'T', value: T, dim: 'time', unit: 'min', usUnit: 'min', digits: 6 },
        angleRow(`${K}.r.maxLatitude`, 'φ_max', el.i <= Math.PI / 2 ? el.i : Math.PI - el.i),
      ],
      latex:
        "\\Delta\\lambda=-\\omega_\\oplus T+\\dot\\Omega T,\\qquad \\phi=\\arcsin\\frac{z}{r},\\quad \\lambda=\\operatorname{atan2}(y',x')",
      steps: [
        { key: `${K}.s.trackShift`, vars: { T: q(T / 60, 'min', 6), shift: q(shift, '°', 6) } },
        ...(withJ2
          ? [
              {
                key: `${K}.s.trackJ2` as const,
                vars: { rate: degPerDay(rates.raanRate), total: q(nodalShift, '°', 6) },
              },
            ]
          : []),
      ] as KitStep[],
      notes: [{ key: `${K}.notes.track` }],
      plot: trackPlot(points),
    };
  },
};

/** The ground track on a longitude-latitude map, split where it wraps past ±180°. */
function trackPlot(points: readonly [number, number][]): Plot {
  const series: PlotSeries[] = [];
  let current: [number, number][] = [];
  let last: number | null = null;
  for (const [lat, lon] of points) {
    const x = deg(lon);
    if (last !== null && Math.abs(x - last) > 180) {
      series.push({ points: current, tone: 'accent', width: 2 });
      current = [];
    }
    current.push([x, deg(lat)]);
    last = x;
  }
  if (current.length) series.push({ points: current, tone: 'accent', width: 2 });
  const [lat0, lon0] = points[0];
  return {
    frame: 'axes',
    alt: { key: `${K}.plot.track` },
    x: { label: 'λ (°)', min: -180, max: 180 },
    y: { label: 'φ (°)', min: -90, max: 90 },
    series: [
      {
        points: [
          [-180, 0],
          [180, 0],
        ],
        tone: 'muted',
      },
      ...series,
    ],
    circles: [{ x: deg(lon0), y: deg(lat0), r: 4, px: true, tone: 'danger', fill: true }],
    legend: [
      { tone: 'accent', key: `${K}.legend.track` },
      { tone: 'danger', key: `${K}.legend.start` },
    ],
  };
}

export const j2Mode: ModeDef = {
  id: 'j2',
  label: `${K}.modes.j2`,
  fields: [
    { id: 'a', label: `${K}.f.a`, dim: 'length', unit: 'km', usUnit: 'mi', initial: '7078.137' },
    { id: 'e', label: `${K}.f.e`, initial: '0' },
    { id: 'i', label: `${K}.f.i`, dim: 'angle', initial: '98.188' },
  ],
  solve(read): Outcome {
    const a = read.num('a', 'positive');
    const e = read.num('e', { min: 0, max: 0.99 });
    const i = read.num('i', { min: 0, max: Math.PI });
    if (a * (1 - e) <= EARTH.radius) return { ok: false, problem: { key: `${K}.errors.belowSurface` } };
    const rates = j2Rates(a, e, i, EARTH);
    const sso = sunSynchronous(a, e, EARTH);
    const T = period(a, EARTH.mu);
    // Revolutions per day against the node line as Earth turns under it.
    const revs = ((EARTH.rotation - rates.raanRate) * T) / (2 * Math.PI);
    const rows: ResultRow[] = [
      rateRow(`${K}.r.raanRate`, 'Ω̇', rates.raanRate, true),
      rateRow(`${K}.r.argpRate`, 'ω̇', rates.argpRate, true),
      sso === null
        ? { key: `${K}.r.sso`, symbol: 'i_SSO', value: '', word: `${K}.kind.noSso` }
        : angleRow(`${K}.r.sso`, 'i_SSO', sso, true),
      { key: `${K}.r.revsPerDay`, symbol: 'revs/day', value: 1 / revs, digits: 6 },
      { key: `${K}.r.period`, symbol: 'T', value: T, dim: 'time', unit: 'min', usUnit: 'min', digits: 6 },
    ];
    const steps: KitStep[] = [
      {
        key: `${K}.s.j2`,
        vars: { a: km(a), e: fmt(e, 6), i: angle(i), raan: degPerDay(rates.raanRate), argp: degPerDay(rates.argpRate) },
      },
      sso === null
        ? { key: `${K}.s.noSso`, vars: { rate: degPerDay(SUN_RATE) } }
        : { key: `${K}.s.sso`, vars: { rate: degPerDay(SUN_RATE), i: angle(sso) } },
    ];
    return {
      ok: true,
      rows,
      latex:
        '\\dot\\Omega=-\\frac{3}{2}\\frac{\\sqrt\\mu J_2R^2}{(1-e^2)^2a^{7/2}}\\cos i,\\quad ' +
        '\\dot\\omega=-\\frac{3}{2}\\frac{\\sqrt\\mu J_2R^2}{(1-e^2)^2a^{7/2}}\\left(\\frac52\\sin^2i-2\\right)',
      steps,
      notes: [{ key: `${K}.notes.j2` }],
    };
  },
};

export const eclipseMode: ModeDef = {
  id: 'eclipse',
  label: `${K}.modes.eclipse`,
  fields: [
    { id: 'h', label: `${K}.f.altitude`, dim: 'length', unit: 'km', usUnit: 'mi', initial: '700' },
    { id: 'beta', label: `${K}.f.beta`, dim: 'angle', initial: '0', help: `${K}.help.beta` },
  ],
  solve(read): Outcome {
    const h = read.num('h', 'positive');
    const beta = read.num('beta', { min: -Math.PI / 2, max: Math.PI / 2 });
    const r = EARTH.radius + h;
    const fraction = eclipseFraction(r, beta, EARTH.radius);
    const T = period(r, EARTH.mu);
    const limit = Math.asin(EARTH.radius / r);
    const curve: [number, number][] = [];
    for (let k = 0; k <= 180; k++) {
      const b = -Math.PI / 2 + (Math.PI * k) / 180;
      curve.push([deg(b), (eclipseFraction(r, b, EARTH.radius) * T) / 60]);
    }
    return {
      ok: true,
      rows: [
        { key: `${K}.r.eclipseFraction`, symbol: 'f_e', value: fraction, digits: 6, primary: true },
        {
          key: `${K}.r.eclipseTime`,
          symbol: 'T_e',
          value: fraction * T,
          dim: 'time',
          unit: 'min',
          usUnit: 'min',
          digits: 6,
          primary: true,
        },
        {
          key: `${K}.r.longestEclipse`,
          symbol: 'T_e,max',
          value: eclipseFraction(r, 0, EARTH.radius) * T,
          dim: 'time',
          unit: 'min',
          usUnit: 'min',
          digits: 6,
        },
        angleRow(`${K}.r.betaLimit`, 'β*', limit),
        { key: `${K}.r.period`, symbol: 'T', value: T, dim: 'time', unit: 'min', usUnit: 'min', digits: 6 },
      ],
      latex:
        'f_e=\\frac{1}{\\pi}\\arccos\\frac{\\sqrt{h^2+2R h}}{(R+h)\\cos\\beta},\\qquad |\\beta|<\\arcsin\\frac{R}{R+h}',
      steps: [
        { key: `${K}.s.betaLimit`, vars: { R: km(EARTH.radius), r: km(r), limit: angle(limit) } },
        fraction > 0
          ? {
              key: `${K}.s.eclipse`,
              vars: { h: km(h), beta: angle(beta), f: fmt(fraction, 6), t: q((fraction * T) / 60, 'min', 6) },
            }
          : { key: `${K}.s.noEclipse` },
      ],
      notes: [{ key: `${K}.notes.eclipse` }],
      plot: {
        frame: 'axes',
        alt: { key: `${K}.plot.eclipse` },
        x: { label: 'β (°)', min: -90, max: 90 },
        y: { label: 'T_e (min)', min: 0 },
        series: [
          { points: curve, tone: 'accent', width: 2 },
          {
            points: [
              [deg(beta), 0],
              [deg(beta), (fraction * T) / 60],
            ],
            tone: 'danger',
            dash: true,
          },
        ],
        legend: [
          { tone: 'accent', key: `${K}.legend.eclipse` },
          { tone: 'danger', key: `${K}.legend.beta`, dash: true },
        ],
      },
    };
  },
};
