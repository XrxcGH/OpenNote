// The fields tool's electric calculations: point charges by superposition with a field-line and equipotential plot,
// Gauss's law for symmetric charge, capacitors, and capacitors in series or parallel.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { EPS0, K_E } from '../kit/constants';
import { fmt, q, qIn } from '../kit/format';
import { fail } from '../kit/read';
import type { KitStep, ModeDef, Outcome, Plot, PlotSeries, ResultRow } from '../kit/types';
import { fromSI } from '../kit/units';
import { chain, levelSegments } from './contour';
import { capacitance, combine, fieldLines, gauss, potentialAt, superpose, viewBox } from './engine';
import type { Box, Capacitor, Charge, Symmetry } from './engine';

const K = 'kitPhysics.fields';
const nC = (c: number) => qIn(c, 'charge', 'nC');
const Ef = (e: number) => q(e, 'N/C');
const Vf = (v: number) => q(v, 'V');

function equipotentials(charges: readonly Charge[], box: Box): { lines: [number, number][][]; levels: number[] } {
  const count = 81;
  const xs = Array.from({ length: count }, (_, i) => box.x0 + ((box.x1 - box.x0) * i) / (count - 1));
  const ys = Array.from({ length: count }, (_, j) => box.y0 + ((box.y1 - box.y0) * j) / (count - 1));
  const most = Math.max(...charges.map((c) => Math.abs(c.q)));
  const ref = (K_E * most) / (0.2 * (box.x1 - box.x0));
  const cap = 8 * ref;
  const z = ys.map((y) => xs.map((x) => Math.max(-cap, Math.min(cap, potentialAt(charges, x, y)))));
  const levels = [-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4].map((k) => k * ref);
  const lines = levels.flatMap((level) => chain(levelSegments(xs, ys, z, level)));
  return { lines, levels };
}

function chargePlot(charges: readonly Charge[], at: [number, number], E: [number, number], unit: string): Plot {
  const box = viewBox(charges, at);
  const u = (m: number) => fromSI(m, 'length', unit);
  const pt = (p: readonly [number, number]): [number, number] => [u(p[0]), u(p[1])];
  const series: PlotSeries[] = [
    ...fieldLines(charges, box).map((line) => ({ points: line.map(pt), tone: 'accent' as const })),
    ...equipotentials(charges, box).lines.map((line) => ({ points: line.map(pt), tone: 'third' as const, dash: true })),
  ];
  const span = u(box.x1 - box.x0);
  const m = Math.hypot(E[0], E[1]);
  const arrow =
    m > 0
      ? [
          {
            x1: u(at[0]),
            y1: u(at[1]),
            x2: u(at[0]) + (0.15 * span * E[0]) / m,
            y2: u(at[1]) + (0.15 * span * E[1]) / m,
            tone: 'danger' as const,
          },
        ]
      : [];
  return {
    frame: 'equal',
    alt: { key: `${K}.plot.charges`, vars: { count: String(charges.length) } },
    x: { label: `x (${unit})`, min: u(box.x0), max: u(box.x1) },
    y: { label: `y (${unit})`, min: u(box.y0), max: u(box.y1) },
    series,
    circles: [
      ...charges.map((c) => ({
        x: u(c.x),
        y: u(c.y),
        r: 6,
        px: true,
        tone: c.q > 0 ? ('accent' as const) : ('second' as const),
        fill: true,
      })),
      { x: u(at[0]), y: u(at[1]), r: 3, px: true, tone: 'danger', fill: true },
    ],
    labels: charges.map((c) => ({
      x: u(c.x),
      y: u(c.y) + 0.05 * span,
      text: c.q > 0 ? '+' : '−',
      anchor: 'middle' as const,
    })),
    arrows: arrow,
    legend: [
      { tone: 'accent', key: `${K}.legend.fieldLines` },
      { tone: 'third', key: `${K}.legend.equipotentials`, dash: true },
      { tone: 'danger', key: `${K}.legend.fieldHere` },
    ],
  };
}

export const chargesMode: ModeDef = {
  id: 'charges',
  label: `${K}.modes.charges`,
  intro: `${K}.help.charges`,
  fields: [
    {
      id: 'charges',
      label: `${K}.f.charges`,
      kind: 'rows',
      initial: '-1 0 1\n1 0 -1',
      columns: [
        { label: `${K}.f.x`, dim: 'length', unit: 'm' },
        { label: `${K}.f.y`, dim: 'length', unit: 'm' },
        { label: `${K}.f.q`, dim: 'charge', unit: 'nC' },
      ],
    },
    // The point starts in the table's length unit for each system, so one picture never mixes meters and feet.
    { id: 'at', label: `${K}.f.at`, kind: 'vector', dim: 'length', unit: 'm', usUnit: 'ft', initial: '0 0' },
    { id: 'test', label: `${K}.f.test`, dim: 'charge', unit: 'nC', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const charges: Charge[] = read.rows('charges').map(([x, y, charge]) => ({ x, y, q: charge }));
    if (charges.length > 12) fail(`${K}.errors.tooMany`);
    if (charges.every((c) => c.q === 0)) fail(`${K}.errors.noCharge`);
    const [x, y] = read.vector('at', 2);
    const unit = read.unit('at');
    const test = read.opt('test');
    const out = superpose(charges, x, y);
    const pos = (px: number, py: number) =>
      `(${fmt(fromSI(px, 'length', unit))}, ${fmt(fromSI(py, 'length', unit))}) ${unit}`;
    const steps: KitStep[] = out.parts.map((part, i) => ({
      key: `${K}.s.charge`,
      vars: {
        k: String(i + 1),
        q: nC(charges[i].q),
        at: pos(charges[i].x, charges[i].y),
        r: qIn(part.r, 'length', unit),
        E: Ef(Math.hypot(part.E[0], part.E[1])),
        ex: Ef(part.E[0]),
        ey: Ef(part.E[1]),
        V: Vf(part.V),
      },
    }));
    steps.push({
      key: `${K}.s.superpose`,
      vars: { ex: Ef(out.E[0]), ey: Ef(out.E[1]), E: Ef(out.magnitude), V: Vf(out.V) },
    });
    const rows: ResultRow[] = [
      { key: `${K}.r.E`, symbol: '|E|', value: out.magnitude, dim: 'efield', unit: 'N/C', primary: true },
      { key: `${K}.r.Ex`, symbol: 'E_x', value: out.E[0], dim: 'efield', unit: 'N/C' },
      { key: `${K}.r.Ey`, symbol: 'E_y', value: out.E[1], dim: 'efield', unit: 'N/C' },
      ...(out.magnitude > 0
        ? [
            {
              key: `${K}.r.direction` as MessageKey,
              symbol: 'φ',
              value: Math.atan2(out.E[1], out.E[0]),
              dim: 'angle' as const,
            },
          ]
        : []),
      { key: `${K}.r.V`, symbol: 'V', value: out.V, dim: 'voltage', unit: 'V', primary: true },
    ];
    if (test !== null) {
      rows.push(
        {
          key: `${K}.r.force`,
          symbol: '|F|',
          value: Math.abs(test) * out.magnitude,
          dim: 'force',
          unit: 'N',
          usUnit: 'lbf',
        },
        { key: `${K}.r.energy`, symbol: 'U', value: test * out.V, dim: 'energy', unit: 'J', usUnit: 'J' },
      );
      steps.push({
        key: `${K}.s.test`,
        vars: { q: nC(test), F: q(Math.abs(test) * out.magnitude, 'N'), U: q(test * out.V, 'J') },
      });
    }
    return {
      ok: true,
      rows,
      latex:
        '\\vec E=\\sum_i\\frac{kq_i}{r_i^2}\\hat r_i,\\qquad V=\\sum_i\\frac{kq_i}{r_i},\\qquad k=\\frac{1}{4\\pi\\varepsilon_0}',
      steps,
      notes: [{ key: `${K}.notes.charges`, vars: { k: q(K_E, 'N·m²/C²') } }],
      plot: chargePlot(charges, [x, y], out.E, unit),
    };
  },
};

const SYMMETRIES: readonly Symmetry[] = [
  'point',
  'shell',
  'solidSphere',
  'line',
  'solidCylinder',
  'sheet',
  'conductor',
];
const spherical = (s: string) => s === 'point' || s === 'shell' || s === 'solidSphere';
const linear = (s: string) => s === 'line' || s === 'solidCylinder';

export const gaussMode: ModeDef = {
  id: 'gauss',
  label: `${K}.modes.gauss`,
  fields: [
    {
      id: 'symmetry',
      label: `${K}.f.symmetry`,
      kind: 'choice',
      initial: 'solidSphere',
      options: SYMMETRIES.map((s) => ({ value: s, label: `${K}.o.${s}` as MessageKey })),
    },
    { id: 'Q', label: `${K}.f.Q`, dim: 'charge', unit: 'nC', initial: '10', when: (ch) => spherical(ch('symmetry')) },
    {
      id: 'lambda',
      label: `${K}.f.lambda`,
      dim: 'chargeLine',
      unit: 'nC/m',
      initial: '10',
      when: (ch) => linear(ch('symmetry')),
    },
    {
      id: 'sigma',
      label: `${K}.f.sigma`,
      dim: 'chargeSurface',
      unit: 'nC/m²',
      initial: '10',
      when: (ch) => !spherical(ch('symmetry')) && !linear(ch('symmetry')),
    },
    {
      id: 'R',
      label: `${K}.f.R`,
      dim: 'length',
      unit: 'cm',
      usUnit: 'in',
      initial: '5',
      when: (ch) => ['shell', 'solidSphere', 'solidCylinder'].includes(ch('symmetry')),
    },
    { id: 'r', label: `${K}.f.r`, dim: 'length', unit: 'cm', usUnit: 'in', initial: '3' },
  ],
  solve(read): Outcome {
    const symmetry = SYMMETRIES.find((s) => s === read.choice('symmetry')) ?? 'point';
    const amount = spherical(symmetry) ? read.num('Q') : linear(symmetry) ? read.num('lambda') : read.num('sigma');
    const hasR = ['shell', 'solidSphere', 'solidCylinder'].includes(symmetry);
    const R = hasR ? read.num('R', 'positive') : 0;
    const r = read.num('r', symmetry === 'sheet' || symmetry === 'conductor' ? 'nonNegative' : 'positive');
    const out = gauss(symmetry, amount, r, R);
    const unit = read.unit('r');
    const amountText = spherical(symmetry)
      ? nC(amount)
      : linear(symmetry)
        ? qIn(amount, 'chargeLine', 'nC/m')
        : qIn(amount, 'chargeSurface', 'nC/m²');
    const enclosedText = spherical(symmetry)
      ? nC(out.enclosed)
      : linear(symmetry)
        ? qIn(out.enclosed, 'chargeLine', 'nC/m')
        : amountText;
    const inside = hasR && r < R;
    const rows: ResultRow[] = [
      { key: `${K}.r.E`, symbol: '|E|', value: Math.abs(out.E), dim: 'efield', unit: 'N/C', primary: true },
      ...(out.V !== null
        ? [{ key: `${K}.r.V` as MessageKey, symbol: 'V', value: out.V, dim: 'voltage' as const, unit: 'V' }]
        : []),
      ...(spherical(symmetry) || linear(symmetry)
        ? [{ key: `${K}.r.enclosed` as MessageKey, symbol: 'q_enc', value: enclosedText }]
        : []),
      {
        key: `${K}.r.direction`,
        value: '',
        word: out.E === 0 ? `${K}.kind.none` : amount > 0 ? `${K}.kind.outward` : `${K}.kind.inward`,
      },
    ];
    const steps: KitStep[] = [
      {
        key: `${K}.s.gauss.${symmetry}${inside ? 'In' : ''}` as MessageKey,
        vars: {
          amount: amountText,
          r: qIn(r, 'length', unit),
          R: qIn(R, 'length', unit),
          enc: enclosedText,
          E: Ef(Math.abs(out.E)),
        },
      },
    ];
    if (out.V !== null) steps.push({ key: `${K}.s.potential`, vars: { V: Vf(out.V) } });
    const plot = spherical(symmetry) || linear(symmetry) ? gaussPlot(symmetry, amount, R, r, unit) : undefined;
    return {
      ok: true,
      rows,
      latex: '\\oint\\vec E\\cdot d\\vec A=\\frac{q_\\mathrm{enc}}{\\varepsilon_0}',
      steps,
      notes: [{ key: `${K}.notes.gauss` }],
      ...(plot ? { plot } : {}),
    };
  },
};

function gaussPlot(symmetry: Symmetry, amount: number, R: number, r: number, unit: string): Plot {
  const end = 3 * Math.max(R, r);
  // A point or line charge's field runs to infinity at r = 0, so its curve starts a little way out.
  const start = symmetry === 'point' || symmetry === 'line' ? 0.25 * Math.max(R, r) : 0;
  const points: [number, number][] = [];
  for (let i = 1; i <= 240; i++) {
    const at = start + ((end - start) * i) / 240;
    points.push([fromSI(at, 'length', unit), Math.abs(gauss(symmetry, amount, at, R).E)]);
  }
  const top = Math.max(...points.map(([, e]) => e));
  return {
    frame: 'axes',
    alt: { key: `${K}.plot.gauss` },
    x: { label: `r (${unit})`, min: 0 },
    y: { label: '|E| (N/C)', min: 0 },
    series: [
      { points, tone: 'accent', width: 2 },
      {
        points: [
          [fromSI(r, 'length', unit), 0],
          [fromSI(r, 'length', unit), top],
        ],
        tone: 'danger',
        dash: true,
      },
    ],
    legend: [
      { tone: 'accent', key: `${K}.legend.E` },
      { tone: 'danger', key: `${K}.legend.r`, dash: true },
    ],
  };
}

const CAPACITORS: readonly Capacitor[] = ['plates', 'coax', 'spheres', 'sphere'];

export const capacitorMode: ModeDef = {
  id: 'capacitor',
  label: `${K}.modes.capacitor`,
  fields: [
    {
      id: 'kind',
      label: `${K}.f.capacitor`,
      kind: 'choice',
      initial: 'plates',
      options: CAPACITORS.map((c) => ({ value: c, label: `${K}.o.${c}` as MessageKey })),
    },
    {
      id: 'A',
      label: `${K}.f.area`,
      dim: 'area',
      unit: 'm²',
      usUnit: 'in²',
      initial: '0.01',
      when: (ch) => ch('kind') === 'plates',
    },
    {
      id: 'd',
      label: `${K}.f.gap`,
      dim: 'length',
      unit: 'mm',
      usUnit: 'in',
      initial: '1',
      when: (ch) => ch('kind') === 'plates',
    },
    {
      id: 'a',
      label: `${K}.f.inner`,
      dim: 'length',
      unit: 'mm',
      usUnit: 'in',
      initial: '1',
      when: (ch) => ch('kind') !== 'plates',
    },
    {
      id: 'b',
      label: `${K}.f.outer`,
      dim: 'length',
      unit: 'mm',
      usUnit: 'in',
      initial: '4',
      when: (ch) => ch('kind') === 'coax' || ch('kind') === 'spheres',
    },
    {
      id: 'L',
      label: `${K}.f.length`,
      dim: 'length',
      unit: 'm',
      usUnit: 'ft',
      initial: '1',
      when: (ch) => ch('kind') === 'coax',
    },
    { id: 'kappa', label: `${K}.f.kappa`, initial: '1', help: `${K}.help.kappa` },
    { id: 'V', label: `${K}.f.voltage`, dim: 'voltage', unit: 'V', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const kind = CAPACITORS.find((c) => c === read.choice('kind')) ?? 'plates';
    const kappa = read.num('kappa', { min: 1 });
    const dims: { A?: number; d?: number; a?: number; b?: number; L?: number } =
      kind === 'plates'
        ? { A: read.num('A', 'positive'), d: read.num('d', 'positive') }
        : {
            a: read.num('a', 'positive'),
            ...(kind === 'sphere' ? {} : { b: read.num('b', 'positive') }),
            ...(kind === 'coax' ? { L: read.num('L', 'positive') } : {}),
          };
    const C = capacitance(kind, kappa, dims);
    const V = read.opt('V');
    const pF = (c: number) => qIn(c, 'capacitance', 'pF');
    const mm = (m: number | undefined) => qIn(m ?? NaN, 'length', 'mm');
    const rows: ResultRow[] = [
      { key: `${K}.r.C`, symbol: 'C', value: C, dim: 'capacitance', unit: 'pF', primary: true },
    ];
    const steps: KitStep[] = [
      {
        key: `${K}.s.cap.${kind}`,
        vars: {
          kappa: fmt(kappa),
          eps0: q(EPS0, 'F/m'),
          A: qIn(dims.A ?? NaN, 'area', 'm²'),
          d: mm(dims.d),
          a: mm(dims.a),
          b: mm(dims.b),
          L: qIn(dims.L ?? NaN, 'length', 'm'),
          C: pF(C),
        },
      },
    ];
    if (V !== null) {
      rows.push(
        { key: `${K}.r.charge`, symbol: 'Q', value: C * V, dim: 'charge', unit: 'nC' },
        { key: `${K}.r.stored`, symbol: 'U', value: 0.5 * C * V * V, dim: 'energy', unit: 'J', usUnit: 'J' },
      );
      steps.push({ key: `${K}.s.charged`, vars: { C: pF(C), V: Vf(V), Q: nC(C * V), U: q(0.5 * C * V * V, 'J') } });
      if (kind === 'plates' && dims.d !== undefined) {
        rows.push({ key: `${K}.r.E`, symbol: '|E|', value: Math.abs(V) / dims.d, dim: 'efield', unit: 'V/m' });
        steps.push({ key: `${K}.s.platesField`, vars: { V: Vf(V), d: mm(dims.d), E: q(Math.abs(V) / dims.d, 'V/m') } });
      }
    }
    return {
      ok: true,
      rows,
      latex:
        kind === 'plates'
          ? 'C=\\frac{\\kappa\\varepsilon_0A}{d}'
          : kind === 'coax'
            ? 'C=\\frac{2\\pi\\kappa\\varepsilon_0L}{\\ln(b/a)}'
            : kind === 'spheres'
              ? 'C=\\frac{4\\pi\\kappa\\varepsilon_0ab}{b-a}'
              : 'C=4\\pi\\kappa\\varepsilon_0a',
      steps,
      notes: [{ key: kind === 'plates' ? `${K}.notes.plates` : `${K}.notes.capacitor` }],
    };
  },
};

export const combinationMode: ModeDef = {
  id: 'combination',
  label: `${K}.modes.combination`,
  fields: [
    {
      id: 'how',
      label: `${K}.f.how`,
      kind: 'choice',
      initial: 'series',
      options: [
        { value: 'series', label: `${K}.o.series` },
        { value: 'parallel', label: `${K}.o.parallel` },
      ],
    },
    {
      id: 'parts',
      label: `${K}.f.parts`,
      kind: 'rows',
      initial: '2\n3\n6',
      columns: [{ label: `${K}.f.C`, dim: 'capacitance', unit: 'µF' }],
    },
    { id: 'V', label: `${K}.f.voltage`, dim: 'voltage', unit: 'V', initial: '', optional: true },
  ],
  solve(read): Outcome {
    const how = read.choice('how') === 'parallel' ? 'parallel' : 'series';
    const parts = read.rows('parts').map(([c]) => c);
    const total = combine(parts, how);
    const V = read.opt('V');
    const uF = (c: number) => qIn(c, 'capacitance', 'µF');
    const rows: ResultRow[] = [
      { key: `${K}.r.Ceq`, symbol: 'C_eq', value: total, dim: 'capacitance', unit: 'µF', primary: true },
    ];
    const steps: KitStep[] = [
      {
        key: how === 'series' ? `${K}.s.series` : `${K}.s.parallel`,
        vars: { list: parts.map(uF).join(', '), C: uF(total) },
      },
    ];
    if (V !== null) {
      const Q = total * V;
      rows.push(
        { key: `${K}.r.charge`, symbol: 'Q', value: Q, dim: 'charge', unit: 'µC' },
        { key: `${K}.r.stored`, symbol: 'U', value: 0.5 * total * V * V, dim: 'energy', unit: 'J', usUnit: 'J' },
      );
      parts.forEach((c, i) =>
        steps.push({
          key: how === 'series' ? `${K}.s.seriesPart` : `${K}.s.parallelPart`,
          vars: {
            k: String(i + 1),
            C: uF(c),
            Q: qIn(how === 'series' ? Q : c * V, 'charge', 'µC'),
            V: Vf(how === 'series' ? Q / c : V),
          },
        }),
      );
    }
    return {
      ok: true,
      rows,
      latex: how === 'series' ? '\\frac{1}{C_{eq}}=\\sum_i\\frac{1}{C_i}' : 'C_{eq}=\\sum_i C_i',
      steps,
      notes: [{ key: `${K}.notes.combination` }],
    };
  },
};
