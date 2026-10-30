// The reliability, quality, and inventory tool: system reliability from a block diagram, life models, Weibull fits,
// control charts, chart constants, process capability, single sampling plans, and the economic order quantity.
import { readNumberList, readNumberMatrix } from '../lib/errors';
import { linspace } from '../lib/num';
import { normalCdf } from '../lib/special';
import { fmt } from '../lib/tf';
import type { PlotSpec } from '../ui/plot';
import { inField } from '../ui/read';
import type { Outcome, Row, ToolSpec, Values } from '../ui/spec';
import {
  capability,
  cChart,
  chartConstants,
  fitWeibull,
  inventory,
  lifeModel,
  operatingCharacteristic,
  pChart,
  systemReliability,
  variablesChart,
  type ChartResult,
  type ChartSeries,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const opt = (v: Values, id: string) => (Number.isFinite(num(v, id)) ? num(v, id) : undefined);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const is =
  (field: string, ...values: string[]) =>
  (t: Texts) =>
    values.includes(t[field]);

function runSystem(values: Values): Outcome {
  const t = opt(values, 'time') ?? 0;
  const r = inField('diagram', () => systemReliability(text(values, 'diagram'), t), { badTime: 'time' });
  const rows: Row[] = [
    { id: 'reliability', value: fmt(r.reliability), tex: `R_s = ${fmt(r.reliability)}`, answer: true },
    { id: 'unreliability', value: fmt(1 - r.reliability) },
  ];
  if (r.mttf !== undefined) rows.push({ id: 'mttf', value: fmt(r.mttf), tex: `\\text{MTTF} = ${fmt(r.mttf)}` });
  const curve = r.curve;
  const plots: PlotSpec[] = curve
    ? [
        {
          id: 'curve',
          x: { label: 'time' },
          y: { label: 'reliability', min: 0, max: 1 },
          series: [{ id: '', points: curve.t.map((x, i) => [x, curve.r[i]] as const) }],
          ...(t > 0 ? { vlines: [{ at: t, pen: 1 }] } : {}),
        },
      ]
    : [];
  return { rows, steps: r.steps, plots, notes: [{ id: r.timed ? 'timed' : 'fixed' }, { id: 'independent' }] };
}

function runLife(values: Values): Outcome {
  const model = text(values, 'model') === 'weibull' ? 'weibull' : 'exp';
  const input = {
    model,
    lambda: num(values, 'lambda'),
    beta: num(values, 'shape'),
    eta: num(values, 'scale'),
    extra: opt(values, 'extra'),
  } as const;
  const byCode = { ratePositive: 'lambda', weibullPositive: 'shape', badTime: 'time' };
  const r = inField(null, () => lifeModel({ ...input, t: num(values, 'time') }), byCode);
  const end = Math.max(4 * r.mttf, num(values, 'time') * 1.5);
  const ts = linspace(0, end, 121);
  const curves = ts.map((x) => lifeModel({ ...input, t: x, extra: undefined }));
  const rows: Row[] = [
    { id: 'reliability', value: fmt(r.r), tex: `R(t) = ${fmt(r.r)}`, answer: true },
    { id: 'unreliability', value: fmt(r.f) },
    { id: 'pdf', value: fmt(r.pdf) },
    { id: 'hazard', value: fmt(r.hazard), tex: `h(t) = ${fmt(r.hazard)}` },
    { id: 'mttf', value: fmt(r.mttf), tex: `\\text{MTTF} = ${fmt(r.mttf)}`, answer: true },
    { id: 'b10', value: fmt(r.b10) },
  ];
  if (r.conditional !== undefined) rows.push({ id: 'conditional', value: fmt(r.conditional) });
  return {
    rows,
    steps: r.steps,
    plots: [
      {
        id: 'lifeCurve',
        x: { label: 'time' },
        y: { label: 'reliability', min: 0, max: 1 },
        series: [{ id: '', points: ts.map((x, i) => [x, curves[i].r] as const) }],
        vlines: [{ at: num(values, 'time'), pen: 1 }],
      },
      {
        id: 'hazardCurve',
        x: { label: 'time' },
        y: { label: 'hazard', min: 0 },
        series: [{ id: '', pen: 1, points: ts.slice(1).map((x, i) => [x, curves[i + 1].hazard] as const) }],
      },
    ],
    notes: [{ id: 'timeUnits' }],
  };
}

function runFit(values: Values): Outcome {
  const times = inField('times', () => readNumberList(text(values, 'times')));
  const r = inField('times', () => fitWeibull(times));
  const xs = r.points.map((p) => p.x);
  const line = [Math.min(...xs), Math.max(...xs)].map((x) => [x, r.beta * (x - Math.log(r.eta))] as const);
  return {
    rows: [
      { id: 'beta', value: fmt(r.beta), tex: `\\beta = ${fmt(r.beta)}`, answer: true },
      { id: 'eta', value: fmt(r.eta), tex: `\\eta = ${fmt(r.eta)}`, answer: true },
      { id: 'r2', value: fmt(r.r2) },
    ],
    steps: r.steps,
    tables: [
      {
        id: 'ranks',
        columns: ['time', 'rank', 'lnT', 'lnLn'],
        rows: r.points.map((p) => [fmt(p.t), fmt(p.f), fmt(p.x), fmt(p.y)]),
      },
    ],
    plots: [
      {
        id: 'weibullPlot',
        x: { label: 'lnT' },
        y: { label: 'lnLn' },
        series: [
          { id: 'failures', style: 'markers', marker: 'o', points: r.points.map((p) => [p.x, p.y] as const) },
          { id: 'fitted', pen: 1, points: line },
        ],
      },
    ],
    notes: [{ id: 'complete' }],
  };
}

const SYMBOL: Readonly<Record<string, string>> = { xbar: 'x̄', r: 'R', s: 's', p: 'p', c: 'c' };

function chartPlot(c: ChartSeries): PlotSpec {
  const xs = c.values.map((_, i) => i + 1);
  return {
    id: `chart_${c.id}`,
    x: { label: 'subgroup' },
    y: { label: c.id },
    series: [
      { id: 'values', marker: 'dot', points: c.values.map((v, i) => [xs[i], v] as const) },
      { id: 'limits', style: 'stairs', pen: 1, points: c.ucl.map((v, i) => [xs[i], v] as const) },
      { id: '', style: 'stairs', pen: 1, points: c.lcl.map((v, i) => [xs[i], v] as const) },
      { id: 'out', style: 'markers', marker: 'x', pen: 1, points: c.out.map((i) => [xs[i], c.values[i]] as const) },
    ],
    hlines: [{ at: c.center, pen: 2 }],
  };
}

function runChart(values: Values): Outcome {
  const kind = text(values, 'chart');
  let r: ChartResult;
  if (kind === 'p') {
    const defectives = inField('defectives', () => readNumberList(text(values, 'defectives')));
    const sizes = inField('sizes', () => readNumberList(text(values, 'sizes')));
    const all = sizes.length === 1 ? defectives.map(() => sizes[0]) : sizes;
    r = inField('defectives', () => pChart(defectives, all), { sizesLength: 'sizes', sizesWhole: 'sizes' });
  } else if (kind === 'c') {
    r = inField('counts', () => cChart(readNumberList(text(values, 'counts'))));
  } else {
    const rows = inField('subgroups', () => readNumberMatrix(text(values, 'subgroups')));
    r = inField('subgroups', () => variablesChart(rows, kind === 'xbarS' ? 's' : 'r'));
  }
  const out = [...new Set(r.charts.flatMap((c) => c.out.map((i) => i + 1)))];
  const rows: Row[] = r.charts.flatMap((c) => [
    { id: 'center', vars: { chart: SYMBOL[c.id] }, value: fmt(c.center) },
    {
      id: 'limitsRow',
      vars: { chart: SYMBOL[c.id] },
      value: `${fmt(Math.min(...c.lcl))} – ${fmt(Math.max(...c.ucl))}`,
    },
  ]);
  rows.push({ id: 'outPoints', value: out.length ? out.join(', ') : '—', answer: true });
  return {
    rows,
    steps: r.steps,
    tables: [
      {
        id: 'points',
        columns: [
          'subgroup',
          ...r.charts.flatMap((c) =>
            [SYMBOL[c.id], `LCL ${SYMBOL[c.id]}`, `UCL ${SYMBOL[c.id]}`].map((text) => ({ text })),
          ),
        ],
        rows: r.charts[0].values.map((_, i) => [
          String(i + 1),
          ...r.charts.flatMap((c) => [fmt(c.values[i]), fmt(c.lcl[i]), fmt(c.ucl[i])]),
        ]),
      },
    ],
    plots: r.charts.map(chartPlot),
    notes: [{ id: 'threeSigma' }],
  };
}

function runConstants(values: Values): Outcome {
  const k = inField('size', () => chartConstants(num(values, 'size')));
  const row = (id: string, v: number, answer = false): Row => ({ id, value: fmt(v), tex: `${id} = ${fmt(v)}`, answer });
  return {
    rows: [
      row('d2', k.d2, true),
      row('d3', k.d3),
      row('c4', k.c4),
      row('A2', k.a2, true),
      row('A3', k.a3),
      row('D3', k.d3Lower),
      row('D4', k.d4Upper),
      row('B3', k.b3),
      row('B4', k.b4),
    ].map((one) => ({ ...one, tex: one.tex?.replace(/^([A-Za-z])(\d)/, '$1_$2') })),
    steps: [],
    notes: [{ id: 'constants' }],
  };
}

function runCapability(values: Values): Outcome {
  const input = {
    usl: num(values, 'usl'),
    lsl: num(values, 'lsl'),
    mean: num(values, 'mean'),
    sigma: num(values, 'sigma'),
  };
  const r = inField(null, () => capability(input), { specOrder: 'usl', sdPositive: 'sigma' });
  const { mean, sigma, lsl, usl } = input;
  const xs = linspace(Math.min(lsl, mean - 4 * sigma), Math.max(usl, mean + 4 * sigma), 161);
  const pdf = (x: number) => Math.exp(-0.5 * ((x - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI));
  return {
    rows: [
      { id: 'cp', value: fmt(r.cp), tex: `C_p = ${fmt(r.cp)}`, answer: true },
      { id: 'cpk', value: fmt(r.cpk), tex: `C_{pk} = ${fmt(r.cpk)}`, answer: true },
      { id: 'cpu', value: fmt(r.cpu) },
      { id: 'cpl', value: fmt(r.cpl) },
      { id: 'ppm', value: fmt(r.fractionOut * 1e6) },
      { id: 'within', value: fmt(normalCdf(usl, mean, sigma) - normalCdf(lsl, mean, sigma)) },
    ],
    steps: r.steps,
    plots: [
      {
        id: 'process',
        x: { label: 'measurement' },
        y: { label: 'density', min: 0 },
        series: [{ id: '', fill: true, points: xs.map((x) => [x, pdf(x)] as const) }],
        vlines: [
          { at: lsl, pen: 1 },
          { at: usl, pen: 1 },
        ],
      },
    ],
    notes: [{ id: 'normalProcess' }],
  };
}

function runSampling(values: Values): Outcome {
  const input = {
    n: num(values, 'sample'),
    c: num(values, 'accept'),
    p: num(values, 'defective'),
    lot: opt(values, 'lot'),
  };
  const r = inField(null, () => operatingCharacteristic(input), {
    nWhole: 'sample',
    acceptRange: 'accept',
    probabilityRange: 'defective',
    lotSize: 'lot',
  });
  return {
    rows: [
      { id: 'pa', value: fmt(r.pa), tex: `P_a = ${fmt(r.pa)}`, answer: true },
      { id: 'aoq', value: fmt(r.aoq) },
      { id: 'aoql', value: fmt(r.aoql) },
    ],
    steps: r.steps,
    plots: [
      {
        id: 'oc',
        x: { label: 'fraction' },
        y: { label: 'accept', min: 0, max: 1 },
        series: [{ id: '', points: r.curve.p.map((p, i) => [p, r.curve.pa[i]] as const) }],
        vlines: [{ at: input.p, pen: 1 }],
      },
      {
        id: 'aoqCurve',
        x: { label: 'fraction' },
        y: { label: 'aoqAxis', min: 0 },
        series: [{ id: '', pen: 2, points: r.curve.p.map((p, i) => [p, r.curve.aoq[i]] as const) }],
      },
    ],
    notes: [{ id: input.lot ? 'rectifying' : 'noLot' }],
  };
}

function runInventory(values: Values): Outcome {
  const service = opt(values, 'service');
  const input = {
    demand: num(values, 'demand'),
    orderCost: num(values, 'orderCost'),
    holdingCost: num(values, 'holdingCost'),
    service: service === undefined ? undefined : service / 100,
    dailyMean: opt(values, 'dailyMean'),
    dailySd: opt(values, 'dailySd'),
    leadDays: opt(values, 'leadDays'),
  };
  const r = inField(null, () => inventory(input), { inventoryPositive: 'demand', serviceRange: 'service' });
  const rows: Row[] = [
    { id: 'eoq', value: fmt(r.eoq), tex: `Q^* = ${fmt(r.eoq)}`, answer: true },
    { id: 'orders', value: fmt(r.orders) },
    { id: 'cycle', value: fmt(r.cycle) },
    { id: 'annualCost', value: fmt(r.annualCost) },
  ];
  if (r.safetyStock !== undefined) {
    rows.push({ id: 'z', value: fmt(r.z ?? 0) });
    rows.push({ id: 'safety', value: fmt(r.safetyStock), tex: `SS = ${fmt(r.safetyStock)}`, answer: true });
    rows.push({ id: 'reorder', value: fmt(r.reorderPoint ?? 0) });
  }
  const qs = linspace(r.eoq * 0.2, r.eoq * 3, 121);
  const { demand: D, orderCost: S, holdingCost: H } = input;
  return {
    rows,
    steps: r.steps,
    plots: [
      {
        id: 'costCurve',
        x: { label: 'quantity' },
        y: { label: 'cost', min: 0 },
        series: [
          { id: 'total', points: qs.map((q) => [q, (D / q) * S + (q / 2) * H] as const) },
          { id: 'ordering', style: 'dash', pen: 1, points: qs.map((q) => [q, (D / q) * S] as const) },
          { id: 'holding', style: 'dash', pen: 2, points: qs.map((q) => [q, (q / 2) * H] as const) },
        ],
        vlines: [{ at: r.eoq, pen: 3 }],
      },
    ],
    notes: [{ id: 'eoq' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  system: runSystem,
  life: runLife,
  fit: runFit,
  chart: runChart,
  constants: runConstants,
  capability: runCapability,
  sampling: runSampling,
  inventory: runInventory,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'system' },
    {
      id: 'diagram',
      type: 'text',
      rows: 3,
      first: 'series(0.9, parallel(0.9, 0.9), kofn(2, 0.9, 0.9, 0.9))',
      when: mode('system'),
    },
    { id: 'model', type: 'choice', options: ['exp', 'weibull'], first: 'weibull', when: mode('life') },
    { id: 'lambda', type: 'number', first: '0.001', when: (t) => t.mode === 'life' && t.model === 'exp' },
    { id: 'shape', type: 'number', first: '2', when: (t) => t.mode === 'life' && t.model !== 'exp' },
    { id: 'scale', type: 'number', first: '1000', when: (t) => t.mode === 'life' && t.model !== 'exp' },
    { id: 'time', type: 'number', first: '500', optional: true, when: mode('system', 'life') },
    { id: 'extra', type: 'number', first: '', optional: true, when: mode('life') },
    { id: 'times', type: 'text', rows: 2, first: '120 190 260 340 410 520 650', when: mode('fit') },
    { id: 'chart', type: 'choice', options: ['xbarR', 'xbarS', 'p', 'c'], first: 'xbarR', when: mode('chart') },
    {
      id: 'subgroups',
      type: 'text',
      rows: 5,
      first: '10.1 9.9 10.0 10.2 9.8\n10.0 10.1 9.9 10.0 10.1\n9.8 10.0 10.2 10.1 9.9\n10.2 10.3 10.1 10.0 10.2',
      when: (t) => t.mode === 'chart' && is('chart', 'xbarR', 'xbarS')(t),
    },
    { id: 'defectives', type: 'text', first: '4 6 3 5 8 2', when: (t) => t.mode === 'chart' && t.chart === 'p' },
    { id: 'sizes', type: 'text', first: '100', when: (t) => t.mode === 'chart' && t.chart === 'p' },
    { id: 'counts', type: 'text', first: '3 5 2 4 9 3', when: (t) => t.mode === 'chart' && t.chart === 'c' },
    { id: 'size', type: 'number', first: '5', when: mode('constants') },
    { id: 'usl', type: 'number', first: '10.5', when: mode('capability') },
    { id: 'lsl', type: 'number', first: '9.5', when: mode('capability') },
    { id: 'mean', type: 'number', first: '10.1', when: mode('capability') },
    { id: 'sigma', type: 'number', first: '0.1', when: mode('capability') },
    { id: 'sample', type: 'number', first: '50', when: mode('sampling') },
    { id: 'accept', type: 'number', first: '1', when: mode('sampling') },
    { id: 'defective', type: 'number', first: '0.02', when: mode('sampling') },
    { id: 'lot', type: 'number', first: '', optional: true, when: mode('sampling') },
    { id: 'demand', type: 'number', first: '1000', when: mode('inventory') },
    { id: 'orderCost', type: 'number', first: '50', when: mode('inventory') },
    { id: 'holdingCost', type: 'number', first: '2', when: mode('inventory') },
    { id: 'service', type: 'number', first: '95', optional: true, when: mode('inventory') },
    { id: 'dailyMean', type: 'number', first: '4', optional: true, when: mode('inventory') },
    { id: 'dailySd', type: 'number', first: '10', optional: true, when: mode('inventory') },
    { id: 'leadDays', type: 'number', first: '4', optional: true, when: mode('inventory') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runSystem)(values);
  },
  examples: [
    { id: 'series', texts: { mode: 'system', diagram: 'series(0.9, 0.9, 0.9)', time: '' } },
    { id: 'parallel', texts: { mode: 'system', diagram: 'parallel(0.9, 0.9)', time: '' } },
    { id: 'kofn', texts: { mode: 'system', diagram: 'kofn(2, 0.9, 0.9, 0.9)', time: '' } },
    {
      id: 'timed',
      texts: {
        mode: 'system',
        diagram: 'series(exp(0.001), parallel(weibull(2, 1000), weibull(2, 1000)))',
        time: '500',
      },
    },
    { id: 'weibull', texts: { mode: 'life', model: 'weibull', shape: '2', scale: '1000', time: '500' } },
    { id: 'fit', texts: { mode: 'fit' } },
    { id: 'xbarR', texts: { mode: 'chart', chart: 'xbarR' } },
    { id: 'pChart', texts: { mode: 'chart', chart: 'p', defectives: '4 6 3 5 8 2 14', sizes: '100' } },
    { id: 'constants', texts: { mode: 'constants', size: '5' } },
    { id: 'capability', texts: { mode: 'capability', usl: '10.5', lsl: '9.5', mean: '10.1', sigma: '0.1' } },
    { id: 'sampling', texts: { mode: 'sampling', sample: '50', accept: '1', defective: '0.02', lot: '1000' } },
    {
      id: 'inventory',
      texts: {
        mode: 'inventory',
        demand: '1000',
        orderCost: '50',
        holdingCost: '2',
        service: '95',
        dailySd: '10',
        leadDays: '4',
      },
    },
  ],
};
