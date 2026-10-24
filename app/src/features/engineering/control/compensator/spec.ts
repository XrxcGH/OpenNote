// The compensator and PID design tool: lead and lag for a phase margin, a lead on the root locus for a damping
// ratio and settling time, and PID gains by Ziegler-Nichols or SIMC. Each design is checked by closing the loop.
import { fmt, readTF, tfTex, tfText, type TF } from '../lib/tf';
import type { PlotSpec, Series } from '../ui/plot';
import { inField } from '../ui/read';
import type { Outcome, Row, Table, ToolSpec, Values } from '../ui/spec';
import { respond, spanOf } from '../systems/engine';
import {
  check,
  designLag,
  designLead,
  designLocusLead,
  pidTF,
  simc,
  ultimate,
  zieglerNichols,
  type Check,
  type Design,
  type Pid,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const optional = (v: Values, id: string) => (Number.isFinite(num(v, id)) ? num(v, id) : undefined);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const plant = (values: Values): TF => inField('g', () => readTF(text(values, 'g')));
const deg = (x: number) => (Number.isFinite(x) ? `${fmt(x)}°` : '∞');
const db = (x: number) => (Number.isFinite(x) ? `${fmt(x)} dB` : '∞');
const sec = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? `${fmt(x)} s` : '—');

/** Before and after, as one row for each measure: "25.4° → 50.2°". */
function compare(before: Check, after: Check): Row[] {
  const row = (id: string, f: (c: Check) => string): Row => ({ id, value: `${f(before)} → ${f(after)}` });
  return [
    row('cmpPm', (c) => deg(c.margins.pm)),
    row('cmpGm', (c) => db(c.margins.gm)),
    row('cmpWgc', (c) => (Number.isFinite(c.margins.wgc) ? `${fmt(c.margins.wgc)} rad/s` : '—')),
    row('cmpOvershoot', (c) => (c.specs ? `${fmt(c.specs.overshoot)}%` : '—')),
    row('cmpRise', (c) => sec(c.specs?.rise)),
    row('cmpSettling', (c) => sec(c.specs?.settling)),
  ];
}

function stepPlot(before: Check, after: Check): PlotSpec {
  const span = Math.min(spanOf(after.closed), 1e4);
  const series: Series[] = [];
  for (const [id, c, pen] of [
    ['after', after, 0],
    ['before', before, 2],
  ] as const) {
    if (!c.specs) continue;
    const r = respond(c.closed, 'step', span);
    series.push({ id, pen, style: id === 'before' ? 'dash' : 'line', points: r.t.map((t, k) => [t, r.y[k]] as const) });
  }
  return { id: 'stepPlot', x: { label: 'time' }, y: { label: 'output' }, series, hlines: [{ at: 1 }] };
}

function outcome(d: Design, rows: Row[], notes: string[]): Outcome {
  return {
    rows: [
      { id: 'c', value: tfText(d.c), tex: `C(s) = ${tfTex(d.c)}`, answer: true },
      ...rows,
      { id: 'pmAfter', value: deg(d.after.margins.pm), answer: true },
      { id: 'closedAfter', value: tfText(d.after.closed) },
      ...compare(d.before, d.after),
    ],
    steps: d.steps,
    latex: `C(s) = ${tfTex(d.c)}`,
    plots: d.after.specs || d.before.specs ? [stepPlot(d.before, d.after)] : [],
    notes: [...notes, ...(d.after.specs ? [] : ['afterUnstable'])].map((id) => ({ id })),
  };
}

function runLead(values: Values): Outcome {
  const g = plant(values);
  const d = inField(
    null,
    () => designLead(g, num(values, 'pm'), optional(values, 'errorTarget'), num(values, 'extra')),
    {
      pmRange: 'pm',
      errorTarget: 'errorTarget',
      typeTooHigh: 'g',
      leadNotNeeded: 'pm',
      leadTooMuch: 'pm',
      improper: 'g',
    },
  );
  const v = d.values;
  return outcome(
    d,
    [
      { id: 'k', value: fmt(v.k) },
      { id: 'alpha', value: fmt(v.alpha), answer: true },
      { id: 'phi', value: deg(v.phi) },
      { id: 'wm', value: `${fmt(v.wm)} rad/s` },
      { id: 'zero', value: fmt(-v.z) },
      { id: 'pole', value: fmt(-v.p) },
    ],
    ['leadForm', 'extraPhase', 'unity'],
  );
}

function runLag(values: Values): Outcome {
  const g = plant(values);
  const d = inField(
    null,
    () => designLag(g, num(values, 'pm'), optional(values, 'errorTarget'), num(values, 'extra')),
    {
      pmRange: 'pm',
      errorTarget: 'errorTarget',
      typeTooHigh: 'g',
      lagNotNeeded: 'pm',
      designNoFrequency: 'pm',
      improper: 'g',
    },
  );
  const v = d.values;
  return outcome(
    d,
    [
      { id: 'k', value: fmt(v.k) },
      { id: 'beta', value: fmt(v.beta), answer: true },
      { id: 'wc', value: `${fmt(v.wc)} rad/s` },
      { id: 'zero', value: fmt(-v.z) },
      { id: 'pole', value: fmt(-v.p) },
    ],
    ['lagForm', 'extraPhase', 'unity'],
  );
}

function runLocus(values: Values): Outcome {
  const g = plant(values);
  const d = inField(
    null,
    () => designLocusLead(g, num(values, 'zeta'), num(values, 'ts'), optional(values, 'zeroAt')),
    {
      zetaRange: 'zeta',
      tsPositive: 'ts',
      zeroPositive: 'zeroAt',
      zeroTooFar: 'zeroAt',
      locusLeadNotNeeded: 'zeta',
      leadTooMuch: 'ts',
      improper: 'g',
    },
  );
  const v = d.values;
  return outcome(
    d,
    [
      { id: 'target', value: `${fmt(v.sdRe)} ± ${fmt(v.sdIm)}i` },
      { id: 'deficit', value: deg(v.deficit) },
      { id: 'zero', value: fmt(-v.a) },
      { id: 'pole', value: fmt(-v.b) },
      { id: 'k', value: fmt(v.k), answer: true },
    ],
    ['dominant', 'unity'],
  );
}

const pidRows = (name: string, p: Pid): string[] => [
  name,
  fmt(p.kp),
  Number.isFinite(p.ti) ? fmt(p.ti) : '∞',
  fmt(p.td),
];

function runZn(values: Values): Outcome {
  const fromPlant = text(values, 'source') === 'plant';
  const g = fromPlant ? plant(values) : null;
  const u = g ? inField('g', () => ultimate(g)) : { ku: num(values, 'ku'), wu: num(values, 'wu') };
  const z = inField(null, () => zieglerNichols(u.ku, u.wu), { ultimatePositive: fromPlant ? 'g' : 'ku' });
  const rows: Row[] = [
    { id: 'ku', value: fmt(z.ku) },
    { id: 'wu', value: `${fmt(z.wu)} rad/s` },
    { id: 'pu', value: `${fmt(z.pu)} s`, answer: true },
    { id: 'kpPid', value: fmt(z.pid.kp), answer: true },
    { id: 'tiPid', value: `${fmt(z.pid.ti)} s`, answer: true },
    { id: 'tdPid', value: `${fmt(z.pid.td)} s`, answer: true },
  ];
  const tables: Table[] = [
    {
      id: 'zn',
      columns: ['controller', 'kp', 'ti', 'td'],
      rows: [pidRows('P', z.p), pidRows('PI', z.pi), pidRows('PID', z.pid)],
    },
  ];
  const out: Outcome = { rows, steps: z.steps, tables, notes: [{ id: 'znAggressive' }] };
  if (!g) return out;
  const c = pidTF(z.pid);
  const before = check({ num: [1], den: [1] }, g);
  const after = check(c, g);
  return {
    ...out,
    rows: [{ id: 'c', value: tfText(c), tex: `C(s) = ${tfTex(c)}` }, ...rows, ...compare(before, after)],
    plots: after.specs || before.specs ? [stepPlot(before, after)] : [],
    notes: [{ id: 'znAggressive' }, { id: 'idealDerivative' }, { id: 'unity' }],
  };
}

function runSimc(values: Values): Outcome {
  const r = inField(
    null,
    () => simc(num(values, 'km'), num(values, 'tau'), num(values, 'theta'), num(values, 'tauC')),
    {
      modelGain: 'km',
      modelTimes: 'tau',
      tauCPositive: 'tauC',
    },
  );
  return {
    rows: [
      { id: 'kpPi', value: fmt(r.pi.kp), answer: true },
      { id: 'tiPi', value: `${fmt(r.pi.ti)} s`, answer: true },
      { id: 'c', value: tfText(pidTF(r.pi)), tex: `C(s) = ${tfTex(pidTF(r.pi))}` },
    ],
    steps: r.steps,
    notes: [{ id: 'simcModel' }, { id: 'simcTauC' }, { id: 'windup' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  lead: runLead,
  lag: runLag,
  locus: runLocus,
  zn: runZn,
  simc: runSimc,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'lead' },
    { id: 'source', type: 'choice', options: ['ultimate', 'plant'], first: 'ultimate', when: mode('zn') },
    {
      id: 'g',
      type: 'text',
      first: '4/(s (s + 2))',
      when: (t) => ['lead', 'lag', 'locus'].includes(t.mode) || (t.mode === 'zn' && t.source === 'plant'),
    },
    { id: 'pm', type: 'number', first: '50', when: mode('lead', 'lag') },
    { id: 'errorTarget', type: 'number', first: '20', optional: true, when: mode('lead', 'lag') },
    { id: 'extra', type: 'number', first: '5', when: mode('lead', 'lag') },
    { id: 'zeta', type: 'number', first: '0.5', when: mode('locus') },
    { id: 'ts', type: 'number', unit: 'time', first: '2', when: mode('locus') },
    { id: 'zeroAt', type: 'number', first: '', optional: true, when: mode('locus') },
    { id: 'ku', type: 'number', first: '48', when: (t) => t.mode === 'zn' && t.source !== 'plant' },
    { id: 'wu', type: 'number', unit: 'rate', first: '2.8284', when: (t) => t.mode === 'zn' && t.source !== 'plant' },
    { id: 'km', type: 'number', first: '2', when: mode('simc') },
    { id: 'tau', type: 'number', unit: 'time', first: '10', when: mode('simc') },
    { id: 'theta', type: 'number', unit: 'time', first: '1', when: mode('simc') },
    { id: 'tauC', type: 'number', unit: 'time', first: '1', when: mode('simc') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runLead)(values);
  },
  examples: [
    { id: 'lead', texts: { mode: 'lead', g: '4/(s (s + 2))', pm: '50', errorTarget: '20' } },
    { id: 'lag', texts: { mode: 'lag', g: '1/(s (s + 1) (0.5 s + 1))', pm: '40', errorTarget: '5' } },
    { id: 'locus', texts: { mode: 'locus', g: '1/(s (s + 2))', zeta: '0.5', ts: '2' } },
    { id: 'zn', texts: { mode: 'zn', source: 'ultimate', ku: '48', wu: '2.8284' } },
    { id: 'znPlant', texts: { mode: 'zn', source: 'plant', g: '1/(s (s + 2) (s + 4))' } },
    { id: 'simc', texts: { mode: 'simc', km: '2', tau: '10', theta: '1', tauC: '1' } },
  ],
};
