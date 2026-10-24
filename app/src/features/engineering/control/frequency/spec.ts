// The frequency response tool: Bode plots with the straight-line asymptotes and margins marked, the closed-loop
// bandwidth and peak, and the Nyquist plot with the encirclement count Z = P − N.
import { step, type Step } from '../lib/steps';
import { complexText, fmt, readTF, tfText, type Complex } from '../lib/tf';
import type { PlotSpec, Series } from '../ui/plot';
import { inField } from '../ui/read';
import type { Outcome, Row, ToolSpec, Values } from '../ui/spec';
import {
  asymptote,
  asymptoteDb,
  closedLoop,
  corners,
  grid,
  magDb,
  makeLoop,
  marginSteps,
  margins,
  nyquist,
  phaseDeg,
  type Loop,
  type Margins,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const optional = (v: Values, id: string) => (Number.isFinite(num(v, id)) ? num(v, id) : undefined);

function loopOf(values: Values): Loop {
  const g = inField('g', () => readTF(text(values, 'g')));
  const delay = optional(values, 'delay') ?? 0;
  return inField('g', () => makeLoop(g, delay), { delayRange: 'delay' });
}

/** Frequencies shown in rad/s or in Hz, as the student chose. */
function units(values: Values) {
  const hz = text(values, 'hz') === 'hz';
  const scale = hz ? 1 / (2 * Math.PI) : 1;
  return {
    hz,
    scale,
    show: (w: number) => (Number.isFinite(w) ? `${fmt(w * scale)} ${hz ? 'Hz' : 'rad/s'}` : '—'),
    axis: hz ? 'frequencyHz' : 'frequencyRad',
  };
}

function marginRows(m: Margins, show: (w: number) => string): Row[] {
  return [
    { id: 'wgc', value: show(m.wgc) },
    { id: 'pm', value: Number.isFinite(m.pm) ? `${fmt(m.pm)}°` : '∞', tex: `PM = ${fmt(m.pm)}^\\circ`, answer: true },
    { id: 'wpc', value: show(m.wpc) },
    {
      id: 'gm',
      value: Number.isFinite(m.gm) ? `${fmt(m.gm)} dB` : '∞',
      tex: `GM = ${fmt(m.gm)}\\ \\text{dB}`,
      answer: true,
    },
    { id: 'delayMargin', value: Number.isFinite(m.delayMargin) ? `${fmt(m.delayMargin)} s` : '—' },
  ];
}

function asymptoteSteps(l: Loop): Step[] {
  const a = asymptote(l);
  let slope = -20 * a.type;
  const steps = [
    step('freq.lowAsymptote', {
      gain: fmt(a.bodeGain),
      db: fmt(20 * Math.log10(Math.abs(a.bodeGain))),
      slope: fmt(slope),
    }),
  ];
  for (const b of a.breaks) {
    slope += b.change;
    steps.push(step('freq.corner', { w: fmt(b.w), change: fmt(b.change), slope: fmt(slope) }));
  }
  return steps;
}

function bodePlots(l: Loop, ws: readonly number[], m: Margins, u: ReturnType<typeof units>): PlotSpec[] {
  const a = asymptote(l);
  const x = (w: number) => w * u.scale;
  const mags: Series = { id: 'magnitude', pen: 0, points: ws.map((w) => [x(w), magDb(l, w)] as const) };
  const asym: Series = {
    id: 'asymptote',
    pen: 2,
    style: 'dash',
    points: ws.map((w) => [x(w), asymptoteDb(a, w)] as const),
  };
  const phase: Series = { id: 'phase', pen: 0, points: ws.map((w) => [x(w), phaseDeg(l, w)] as const) };
  const vlines = [
    ...(Number.isFinite(m.wgc) ? [{ at: x(m.wgc), pen: 1 }] : []),
    ...(Number.isFinite(m.wpc) ? [{ at: x(m.wpc), pen: 3 }] : []),
  ];
  return [
    {
      id: 'magPlot',
      x: { label: u.axis, log: true },
      y: { label: 'db' },
      series: [mags, asym],
      hlines: [{ at: 0 }],
      vlines,
    },
    {
      id: 'phasePlot',
      x: { label: u.axis, log: true },
      y: { label: 'degrees' },
      series: [phase],
      hlines: [{ at: -180 }],
      vlines,
    },
  ];
}

function runBode(values: Values): Outcome {
  const l = loopOf(values);
  const u = units(values);
  const ws = inField(null, () => grid(l, optional(values, 'wMin'), optional(values, 'wMax')), { rangeOrder: 'wMax' });
  const m = margins(l, ws);
  const c = closedLoop(l, ws);
  const at = optional(values, 'at');
  const rows: Row[] = [
    { id: 'loop', value: tfText(l.g) + (l.delay ? ` · e^(−${fmt(l.delay)}s)` : '') },
    ...marginRows(m, u.show),
    { id: 'bandwidth', value: u.show(c.bandwidth) },
    { id: 'peak', value: `${fmt(c.peakDb)} dB` },
    { id: 'wPeak', value: u.show(c.wPeak) },
    { id: 'dc', value: fmt(c.dc) },
  ];
  if (at !== undefined) {
    rows.push(
      { id: 'magAt', vars: { w: u.show(at) }, value: `${fmt(magDb(l, at))} dB`, answer: true },
      { id: 'phaseAt', vars: { w: u.show(at) }, value: `${fmt(phaseDeg(l, at))}°`, answer: true },
    );
  }
  const marks = [...corners(l), ...m.gainCrossovers, ...m.phaseCrossovers].sort((a, b) => a - b);
  return {
    rows,
    steps: [
      ...asymptoteSteps(l),
      ...marginSteps(l, m),
      step('freq.closed', { bw: fmt(c.bandwidth), peak: fmt(c.peakDb) }),
    ],
    tables: [
      {
        id: 'points',
        columns: ['w', 'mag', 'phase'],
        rows: marks.map((w) => [u.show(w), fmt(magDb(l, w)), fmt(phaseDeg(l, w))]),
      },
    ],
    plots: bodePlots(l, ws, m, u),
    notes: [{ id: 'phase' }, { id: 'unity' }, ...(l.delay ? [{ id: 'delay' }] : [])],
  };
}

function nyquistPlot(upper: readonly Complex[]): PlotSpec {
  const sizes = upper.map((z) => Math.hypot(z.re, z.im)).filter(Number.isFinite);
  const radius = Math.max(3, 1.5 * Math.min(Math.max(...sizes), 20));
  const segments: Complex[][] = [[]];
  for (const z of upper) {
    if (Number.isFinite(z.re) && Math.hypot(z.re, z.im) <= radius) segments[segments.length - 1].push(z);
    else if (segments[segments.length - 1].length) segments.push([]);
  }
  const series: Series[] = [];
  segments
    .filter((s) => s.length > 1)
    .forEach((s, i) => {
      series.push({ id: i ? '' : 'positive', pen: 0, points: s.map((z) => [z.re, z.im] as const) });
      series.push({ id: i ? '' : 'negative', pen: 0, style: 'dash', points: s.map((z) => [z.re, -z.im] as const) });
    });
  series.push({ id: 'critical', style: 'markers', marker: 'x', pen: 1, points: [[-1, 0]] });
  return { id: 'nyquistPlot', x: { label: 'real' }, y: { label: 'imag' }, equal: true, series };
}

function runNyquist(values: Values): Outcome {
  const l = loopOf(values);
  const u = units(values);
  const r = inField('g', () => nyquist(l), { delayProper: 'delay' });
  const m = margins(l, grid(l));
  const verdict = r.marginal ? 'marginal' : r.z === 0 ? 'stable' : 'unstable';
  const steps: Step[] = [
    step('freq.contour', { axis: String(r.axisPoles) }),
    step('freq.openRhp', { p: String(r.p) }),
    step('freq.encircle', { ccw: String(r.ccw) }),
    step(
      'freq.criterion',
      { p: String(r.p), ccw: String(r.ccw), z: String(r.z) },
      `Z = P - N_{ccw} = ${r.p} - (${r.ccw}) = ${r.z}`,
    ),
  ];
  return {
    rows: [
      { id: 'p', value: String(r.p) },
      { id: 'ccw', value: String(r.ccw) },
      { id: 'z', value: String(r.z), tex: `Z = ${r.z}`, answer: true },
      { id: verdict, value: '✓', answer: true },
      ...(r.closedPoles ? [{ id: 'closedPoles', value: r.closedPoles.map((z) => complexText(z)).join(', ') }] : []),
      ...marginRows(m, u.show),
    ],
    steps: [...steps, ...marginSteps(l, m)],
    plots: [nyquistPlot(r.upper)],
    notes: [{ id: 'contour' }, { id: 'unity' }, ...(r.marginal ? [{ id: 'marginal' }] : [])],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = { bode: runBode, nyquist: runNyquist };

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'bode' },
    { id: 'g', type: 'text', first: '10/(s (s + 1) (s + 5))' },
    { id: 'delay', type: 'number', unit: 'time', first: '', optional: true },
    { id: 'hz', type: 'choice', options: ['rad', 'hz'], first: 'rad' },
    { id: 'at', type: 'number', unit: 'rate', first: '', optional: true, when: mode('bode') },
    { id: 'wMin', type: 'number', unit: 'rate', first: '', optional: true, when: mode('bode') },
    { id: 'wMax', type: 'number', unit: 'rate', first: '', optional: true, when: mode('bode') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runBode)(values);
  },
  examples: [
    { id: 'margins', texts: { mode: 'bode', g: '10/(s (s + 1) (s + 5))' } },
    { id: 'firstOrder', texts: { mode: 'bode', g: '1/(s + 1)', at: '1' } },
    { id: 'delay', texts: { mode: 'bode', g: '2/(s + 1)', delay: '0.2' } },
    { id: 'unstableOpen', texts: { mode: 'nyquist', g: '2 (s + 1)/(s (s - 1))' } },
    { id: 'nyquistUnstable', texts: { mode: 'nyquist', g: '40/(s (s + 1) (s + 5))' } },
    { id: 'resonant', texts: { mode: 'bode', g: '4/(s (s + 1.2))' } },
  ],
};
