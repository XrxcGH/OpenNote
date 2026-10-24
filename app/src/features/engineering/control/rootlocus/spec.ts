// The root locus and Routh-Hurwitz tool: the Routh array of a polynomial, the gains that keep a loop stable, the
// root locus with every construction rule, and the gain for a chosen point or damping ratio.
import { readComplexList } from '../lib/complexList';
import { boundaryCrossings, closedPoly, stableRanges } from '../lib/locus';
import { step } from '../lib/steps';
import { complexText, fmt, polyText, readTF, tfText, type Complex, type TF } from '../lib/tf';
import { locusMap } from '../ui/maps';
import type { PlotSpec, Series } from '../ui/plot';
import { inField } from '../ui/read';
import { FieldProblem, type Outcome, type Row, type Table, type ToolSpec, type Values } from '../ui/spec';
import {
  closedAt,
  gainForDamping,
  gainForPoint,
  locusRules,
  rangesText,
  routh,
  type Routh,
  type Rules,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const list = (zs: readonly Complex[]) => zs.map((z) => complexText(z)).join(', ') || '—';
const loop = (values: Values): TF => inField('g', () => readTF(text(values, 'g')));

function routhTable(r: Routh): Table {
  const width = Math.max(...r.rows.map((row) => row.cells.length));
  return {
    id: 'routh',
    columns: ['power', ...Array.from({ length: width }, (_, j) => ({ text: String(j + 1) }))],
    rows: r.rows.map((row) => [
      `s${sup(row.power)}`,
      ...row.cells,
      ...new Array<string>(width - row.cells.length).fill(''),
    ]),
  };
}

const sup = (k: number) =>
  String(k)
    .split('')
    .map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
    .join('');

function verdict(r: Routh): string {
  if (r.rhp > 0 || r.repeatedAxis) return 'unstable';
  return r.axis > 0 ? 'marginal' : 'stable';
}

function runRouth(values: Values): Outcome {
  const p = inField('poly', () => readTF(text(values, 'poly')));
  if (p.den.length > 1) throw new FieldProblem('poly', 'notPolynomial');
  const r = inField('poly', () => routh(p.num));
  return {
    rows: [
      { id: 'polynomial', value: polyText(p.num) },
      { id: 'signChanges', value: String(r.signChanges) },
      { id: 'rhp', value: String(r.rhp), answer: true },
      { id: 'axis', value: String(r.axis) },
      { id: 'lhp', value: String(r.lhp) },
      { id: verdict(r), value: '✓', answer: true },
      { id: 'roots', value: list(r.roots) },
    ],
    steps: r.steps,
    tables: [routhTable(r)],
    notes: [{ id: 'epsilon' }, { id: 'rootsCheck' }],
  };
}

function runRange(values: Values): Outcome {
  const g = loop(values);
  const rules = inField('g', () => locusRules(g));
  const crossings = boundaryCrossings(g.num, g.den, 's').filter((c) => c.k > 0);
  const steps = [step('range.equation', { poly: polyText(g.den), num: polyText(g.num) })];
  const tables: Table[] = [];
  for (const c of crossings.slice(0, 3)) steps.push(step('range.atCrossing', { k: fmt(c.k), w: fmt(c.at) }));
  // At the first crossing gain the Routh array has a row of zeros, whose auxiliary polynomial gives ω.
  if (crossings.length) tables.push({ ...routhTable(routh(closedPoly(g.num, g.den, crossings[0].k))), id: 'routhAtK' });
  steps.push(step('locus.ranges', { ranges: rangesText(stableRanges(g.num, g.den, 's')) }));
  return {
    rows: [
      { id: 'ranges', value: rangesText(rules.ranges), answer: true },
      ...crossings.map((c, i) => ({
        id: 'crossing',
        vars: { n: String(i + 1) },
        value: `K = ${fmt(c.k)}, ω = ${fmt(c.at)} rad/s`,
      })),
    ],
    steps,
    tables,
    plots: [locusPlot(rules, [])],
    notes: [{ id: 'gainSign' }, { id: 'unity' }],
  };
}

function locusPlot(r: Rules, marks: readonly Complex[]): PlotSpec {
  const span = Math.max(1, ...[...r.poles, ...r.zeros].map((z) => Math.hypot(z.re, z.im))) * 3;
  const extra: Series[] = [];
  if (r.centroid !== null) {
    r.asymptotes.forEach((a, i) => {
      const t = (a * Math.PI) / 180;
      extra.push({
        id: i ? '' : 'asymptotes',
        style: 'dash',
        pen: 2,
        points: [
          [r.centroid ?? 0, 0],
          [(r.centroid ?? 0) + span * Math.cos(t), span * Math.sin(t)],
        ],
      });
    });
  }
  if (r.breaks.length)
    extra.push({
      id: 'breaks',
      style: 'markers',
      marker: 'dot',
      pen: 3,
      points: r.breaks.map((b) => [b.point.re, b.point.im] as const),
    });
  if (marks.length)
    extra.push({
      id: 'chosen',
      style: 'markers',
      marker: 'dot',
      pen: 1,
      points: marks.map((z) => [z.re, z.im] as const),
    });
  return locusMap('locusPlot', r.locus, r.poles, r.zeros, 's', extra);
}

function runLocus(values: Values): Outcome {
  const g = loop(values);
  const r = inField('g', () => locusRules(g));
  const ks = [0, ...r.breaks.map((b) => b.k), ...r.crossings.map((c) => c.k)];
  const top = Math.max(10, 2 * Math.max(...ks));
  ks.push(top / 4, top / 2, top);
  const unique = [...new Set(ks.map((k) => Number(k.toPrecision(10))))].sort((a, b) => a - b);
  const rows: Row[] = [
    { id: 'loop', value: tfText(g) },
    { id: 'poles', value: list(r.poles) },
    { id: 'zeros', value: list(r.zeros) },
    { id: 'centroid', value: r.centroid === null ? '—' : fmt(r.centroid), answer: true },
    { id: 'asymptotes', value: r.asymptotes.map((a) => `${fmt(a)}°`).join(', ') || '—', answer: true },
    {
      id: 'breaks',
      value: r.breaks.map((b) => `${complexText(b.point)} (K = ${fmt(b.k)})`).join('; ') || '—',
      answer: true,
    },
    ...r.departures.map((d) => ({ id: 'departure', vars: { at: complexText(d.at) }, value: `${fmt(d.angleDeg)}°` })),
    ...r.arrivals.map((d) => ({ id: 'arrival', vars: { at: complexText(d.at) }, value: `${fmt(d.angleDeg)}°` })),
    {
      id: 'crossings',
      value: r.crossings.map((c) => `ω = ${fmt(c.at)} rad/s (K = ${fmt(c.k)})`).join('; ') || '—',
      answer: true,
    },
    { id: 'ranges', value: rangesText(r.ranges) },
  ];
  return {
    rows,
    steps: r.steps,
    tables: [{ id: 'gains', columns: ['k', 'closedPoles'], rows: unique.map((k) => [fmt(k), list(closedAt(g, k))]) }],
    plots: [locusPlot(r, [])],
    notes: [{ id: 'gainSign' }, { id: 'unity' }, { id: 'repeated' }],
  };
}

function runGain(values: Values): Outcome {
  const g = loop(values);
  const r = inField('g', () => locusRules(g));
  if (text(values, 'by') === 'point') {
    const pts = inField('point', () => readComplexList(text(values, 'point')));
    const s0 = pts.find((z) => z.im >= 0) ?? pts[0];
    if (!s0) throw new FieldProblem('point', 'required');
    const res = inField('point', () => gainForPoint(g, s0));
    const wn = Math.hypot(s0.re, s0.im);
    return {
      rows: [
        { id: 'gain', value: fmt(res.k), tex: `K = ${fmt(res.k)}`, answer: true },
        { id: 'closed', value: list(res.closed) },
        { id: 'wn', value: `${fmt(wn)} rad/s` },
        { id: 'zeta', value: fmt(-s0.re / wn) },
      ],
      steps: res.steps,
      plots: [locusPlot(r, [s0, { re: s0.re, im: -s0.im }])],
      notes: [{ id: 'gainSign' }],
    };
  }
  const zeta = Number(text(values, 'zeta'));
  const hits = inField('zeta', () => gainForDamping(g, zeta));
  const rows: Row[] = hits.length
    ? hits.flatMap((h, i) => [
        {
          id: 'zetaHit',
          vars: { n: String(i + 1) },
          value: `K = ${fmt(h.k)}, s = ${complexText(h.point)}`,
          answer: i === 0,
        },
        { id: 'zetaPoles', vars: { n: String(i + 1) }, value: list(h.closed) },
      ])
    : [{ id: 'zetaNone', value: '—' }];
  return {
    rows,
    steps: [
      step('locus.zetaLine', { zeta: fmt(zeta), angle: fmt((Math.acos(zeta) * 180) / Math.PI) }),
      ...hits.map((h) => step('locus.zetaFound', { k: fmt(h.k), point: complexText(h.point), wn: fmt(h.wn) })),
    ],
    plots: [
      locusPlot(
        r,
        hits.flatMap((h) => [h.point, { re: h.point.re, im: -h.point.im }]),
      ),
    ],
    notes: [{ id: 'gainSign' }, { id: 'dominant' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  routh: runRouth,
  range: runRange,
  locus: runLocus,
  gain: runGain,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'locus' },
    { id: 'poly', type: 'text', first: 's^4 + 2s^3 + 3s^2 + 6s + 5', when: mode('routh') },
    { id: 'g', type: 'text', first: '1/(s (s + 2) (s + 4))', when: mode('range', 'locus', 'gain') },
    { id: 'by', type: 'choice', options: ['zeta', 'point'], first: 'zeta', when: mode('gain') },
    { id: 'zeta', type: 'number', first: '0.5', when: (t) => t.mode === 'gain' && t.by !== 'point' },
    { id: 'point', type: 'text', first: '-1 + 1.5i', when: (t) => t.mode === 'gain' && t.by === 'point' },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runLocus)(values);
  },
  examples: [
    { id: 'third', texts: { mode: 'locus', g: '1/(s (s + 2) (s + 4))' } },
    { id: 'departure', texts: { mode: 'locus', g: '(s + 2)/(s^2 + 2s + 2)' } },
    { id: 'range', texts: { mode: 'range', g: '1/(s (s + 2) (s + 4))' } },
    { id: 'epsilon', texts: { mode: 'routh', poly: 's^4 + 2s^3 + 3s^2 + 6s + 5' } },
    { id: 'zeros', texts: { mode: 'routh', poly: 's^3 + 2s^2 + 4s + 8' } },
    { id: 'zeta', texts: { mode: 'gain', g: '1/(s (s + 2) (s + 4))', by: 'zeta', zeta: '0.5' } },
    { id: 'point', texts: { mode: 'gain', g: '1/(s (s + 2) (s + 4))', by: 'point', point: '2.82843i' } },
  ],
};
