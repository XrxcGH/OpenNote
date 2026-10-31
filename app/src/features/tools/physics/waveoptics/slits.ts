// The wave optics tool's diffraction calculations: double slit, single slit, grating, and circular aperture.
import { deg, fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, ResultRow } from '../kit/types';
import { sub } from '../kit/symbols';
import { AIRY, airy, doubleSlit, grating, rayleigh, singleSlit, slitIntensity } from './engine';

const nm = (m: number) => qIn(m, 'length', 'nm');
const mm = (m: number) => qIn(m, 'length', 'mm');
const angle = (radians: number) => q(deg(radians), '°');
const lambdaField = {
  id: 'lambda',
  label: 'kitPhysics.waveoptics.f.lambda',
  dim: 'length',
  unit: 'nm',
  usUnit: 'nm',
} as const;
const screenField = { id: 'L', label: 'kitPhysics.waveoptics.f.L', dim: 'length', initial: '1' } as const;

/** Intensity across the screen out to `half` either side, with the single-slit envelope when the slits have width. */
function slitPlot(lambda: number, d: number, a: number, L: number, half: number): Plot {
  const at = (y: number) => Math.atan(y / L);
  const xs = Array.from({ length: 801 }, (_, i) => -half + (2 * half * i) / 800);
  const pattern = xs.map((y): [number, number] => [y * 1e3, slitIntensity(lambda, d, a, at(y))]);
  const series: Plot['series'][number][] = [{ points: pattern, tone: 'accent', width: 1.5 }];
  if (a > 0 && d > 0)
    series.push({
      points: xs.map((y): [number, number] => [y * 1e3, slitIntensity(lambda, 0, a, at(y))]),
      tone: 'second',
      dash: true,
      width: 1,
    });
  return {
    frame: 'axes',
    alt: { key: 'kitPhysics.waveoptics.plot.slits' },
    x: { label: 'y (mm)' },
    y: { label: 'I / I₀', min: 0, max: 1.05 },
    series,
    legend:
      series.length > 1
        ? [
            { tone: 'accent', key: 'kitPhysics.waveoptics.legend.pattern' },
            { tone: 'second', key: 'kitPhysics.waveoptics.legend.envelope', dash: true },
          ]
        : undefined,
  };
}

export const doubleMode: ModeDef = {
  id: 'double',
  label: 'kitPhysics.waveoptics.modes.double',
  fields: [
    { ...lambdaField, initial: '600' },
    { id: 'd', label: 'kitPhysics.waveoptics.f.d', dim: 'length', unit: 'mm', usUnit: 'mm', initial: '0.1' },
    screenField,
    {
      id: 'a',
      label: 'kitPhysics.waveoptics.f.width',
      dim: 'length',
      unit: 'mm',
      usUnit: 'mm',
      initial: '',
      optional: true,
      help: 'kitPhysics.waveoptics.help.width',
    },
    { id: 'orders', label: 'kitPhysics.waveoptics.f.orders', initial: '3' },
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const d = read.num('d', 'positive');
    const L = read.num('L', 'positive');
    const a = read.opt('a', 'positive') ?? 0;
    const orders = read.num('orders', { min: 1, max: 20 });
    if (!Number.isInteger(orders))
      fail('kitPhysics.errors.range', { min: '1', max: '20' }, { field: 'kitPhysics.waveoptics.f.orders' });
    if (a > d) fail('kitPhysics.waveoptics.errors.slitTooNarrow');
    const out = doubleSlit(lambda, d, L, orders);
    const bright = out.fringes.slice(1);
    const steps: KitStep[] = [
      { key: 'kitPhysics.waveoptics.s.double' },
      {
        key: 'kitPhysics.waveoptics.s.spacing',
        vars: { lambda: nm(lambda), L: q(L, 'm'), d: mm(d), dy: mm(out.spacing) },
      },
      ...bright.slice(0, 3).map((f) => ({
        key: 'kitPhysics.waveoptics.s.fringe' as const,
        vars: { m: String(f.m), lambda: nm(lambda), d: mm(d), theta: angle(f.theta), y: mm(f.y) },
      })),
    ];
    if (a > 0) steps.push({ key: 'kitPhysics.waveoptics.s.envelope', vars: { a: mm(a) } });
    const rows: ResultRow[] = [
      {
        key: 'kitPhysics.waveoptics.r.spacing',
        symbol: 'Δy',
        value: out.spacing,
        dim: 'length',
        unit: 'mm',
        usUnit: 'in',
        primary: true,
      },
      ...bright.map((f) => ({
        key: 'kitPhysics.waveoptics.r.fringe' as const,
        symbol: `y${sub(f.m)}`,
        value: f.y,
        dim: 'length' as const,
        unit: 'mm',
        usUnit: 'in',
      })),
    ];
    if (bright.length)
      rows.push({ key: 'kitPhysics.waveoptics.r.fringeAngle', symbol: 'θ₁', value: bright[0].theta, dim: 'angle' });
    const half = Math.min(L * 2, Math.max(...out.fringes.map((f) => f.y), out.spacing) * 1.15);
    return {
      ok: true,
      rows,
      latex: 'd\\sin\\theta=m\\lambda,\\qquad \\Delta y=\\frac{\\lambda L}{d}',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.smallAngle' }, { key: 'kitPhysics.waveoptics.notes.exactAngle' }],
      plot: slitPlot(lambda, d, a, L, half),
    };
  },
};

export const singleMode: ModeDef = {
  id: 'single',
  label: 'kitPhysics.waveoptics.modes.single',
  fields: [
    { ...lambdaField, initial: '600' },
    { id: 'a', label: 'kitPhysics.waveoptics.f.a', dim: 'length', unit: 'mm', usUnit: 'mm', initial: '0.05' },
    screenField,
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const a = read.num('a', 'positive');
    const L = read.num('L', 'positive');
    const out = singleSlit(lambda, a, L);
    return {
      ok: true,
      rows: [
        {
          key: 'kitPhysics.waveoptics.r.minimum',
          symbol: 'y₁',
          value: out.y,
          dim: 'length',
          unit: 'mm',
          usUnit: 'in',
          primary: true,
        },
        {
          key: 'kitPhysics.waveoptics.r.minimumSmall',
          symbol: 'λL/a',
          value: out.small,
          dim: 'length',
          unit: 'mm',
          usUnit: 'in',
        },
        { key: 'kitPhysics.waveoptics.r.minimumAngle', symbol: 'θ₁', value: out.theta, dim: 'angle' },
        {
          key: 'kitPhysics.waveoptics.r.central',
          symbol: '2y₁',
          value: out.width,
          dim: 'length',
          unit: 'mm',
          usUnit: 'in',
        },
      ],
      latex: 'a\\sin\\theta=m\\lambda,\\quad m=\\pm1,\\pm2,\\ldots',
      steps: [
        { key: 'kitPhysics.waveoptics.s.single', vars: { lambda: nm(lambda), a: mm(a), theta: angle(out.theta) } },
        {
          key: 'kitPhysics.waveoptics.s.singleY',
          vars: { L: q(L, 'm'), theta: angle(out.theta), y: mm(out.y), small: mm(out.small) },
        },
      ],
      notes: [{ key: 'kitPhysics.waveoptics.notes.smallAngle' }, { key: 'kitPhysics.waveoptics.notes.exactAngle' }],
      plot: slitPlot(lambda, 0, a, L, Math.min(3.2 * out.y, 2 * L)),
    };
  },
};

export const gratingMode: ModeDef = {
  id: 'grating',
  label: 'kitPhysics.waveoptics.modes.grating',
  fields: [
    { ...lambdaField, initial: '500' },
    { id: 'lines', label: 'kitPhysics.waveoptics.f.lines', initial: '600' },
    { id: 'N', label: 'kitPhysics.waveoptics.f.illuminated', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const lines = read.num('lines', 'positive');
    const N = read.opt('N', 'positive');
    const d = 1e-3 / lines;
    const orders = grating(lambda, d);
    const steps: KitStep[] = [
      { key: 'kitPhysics.waveoptics.s.gratingD', vars: { lines: fmt(lines), d: nm(d) } },
      ...orders.slice(0, 4).map((o) => ({
        key: 'kitPhysics.waveoptics.s.order' as const,
        vars: { m: String(o.m), s: fmt((o.m * lambda) / d, 6), theta: angle(o.theta) },
      })),
    ];
    const rows: ResultRow[] = [
      ...orders.map((o) => ({
        key: 'kitPhysics.waveoptics.r.order' as const,
        symbol: `θ${sub(o.m)}`,
        value: o.theta,
        dim: 'angle' as const,
        primary: o.m === 1,
      })),
      { key: 'kitPhysics.waveoptics.r.d', symbol: 'd', value: d, dim: 'length', unit: 'nm', usUnit: 'nm' },
      { key: 'kitPhysics.waveoptics.r.maxOrder', symbol: 'm_max', value: orders.length },
    ];
    if (N !== null) {
      // R = m N grows with the order, so each order the grating shows gets its own resolving power.
      for (const o of orders) {
        rows.push(
          { key: 'kitPhysics.waveoptics.r.resolving', symbol: `R${sub(o.m)}`, value: o.m * N },
          {
            key: 'kitPhysics.waveoptics.r.resolvable',
            symbol: `Δλ${sub(o.m)}`,
            value: lambda / (o.m * N),
            dim: 'length',
            unit: 'nm',
            usUnit: 'nm',
          },
        );
      }
      const top = orders[orders.length - 1].m;
      steps.push({
        key: 'kitPhysics.waveoptics.s.resolving',
        vars: { R: fmt(N), dl: nm(lambda / N), m: String(top), Rm: fmt(top * N), dlm: nm(lambda / (top * N)) },
      });
    }
    return {
      ok: true,
      rows,
      latex: 'd\\sin\\theta=m\\lambda,\\qquad R=\\frac{\\lambda}{\\Delta\\lambda}=mN',
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.normal' }],
    };
  },
};

export const circularMode: ModeDef = {
  id: 'circular',
  label: 'kitPhysics.waveoptics.modes.circular',
  fields: [
    { ...lambdaField, initial: '550' },
    { id: 'D', label: 'kitPhysics.waveoptics.f.D', dim: 'length', unit: 'mm', usUnit: 'in', initial: '5' },
    { id: 'R', label: 'kitPhysics.waveoptics.f.distance', dim: 'length', unit: 'm', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const lambda = read.num('lambda', 'positive');
    const D = read.num('D', 'positive');
    const R = read.opt('R', 'positive');
    const out = rayleigh(lambda, D);
    const steps: KitStep[] = [
      { key: 'kitPhysics.waveoptics.s.rayleigh', vars: { lambda: nm(lambda), D: mm(D), theta: angle(out.theta) } },
    ];
    const rows: ResultRow[] = [
      { key: 'kitPhysics.waveoptics.r.angular', symbol: 'θ_R', value: out.theta, dim: 'angle', primary: true },
    ];
    if (R !== null) {
      const s = R * Math.tan(out.theta);
      rows.push({
        key: 'kitPhysics.waveoptics.r.separation',
        symbol: 's',
        value: s,
        dim: 'length',
        unit: 'mm',
        usUnit: 'in',
      });
      steps.push({ key: 'kitPhysics.waveoptics.s.separation', vars: { distance: q(R, 'm'), s: mm(s) } });
    }
    const top = Math.min(Math.PI / 2, 3 * out.theta);
    const points = Array.from({ length: 601 }, (_, i): [number, number] => {
      const th = -top + (2 * top * i) / 600;
      return [deg(th), airy(lambda, D, th)];
    });
    return {
      ok: true,
      rows,
      latex: `\\sin\\theta_R=${AIRY.toFixed(5)}\\,\\frac{\\lambda}{D}`,
      steps,
      notes: [{ key: 'kitPhysics.waveoptics.notes.airy' }],
      plot: {
        frame: 'axes',
        alt: { key: 'kitPhysics.waveoptics.plot.airy' },
        x: { label: 'θ (°)' },
        y: { label: 'I / I₀', min: 0, max: 1.05 },
        series: [{ points, tone: 'accent', width: 1.5 }],
      },
    };
  },
};
