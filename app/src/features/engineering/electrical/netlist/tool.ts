// The circuit simulator: a short SPICE-style netlist, and a DC operating point, an AC sweep, a transient response,
// or a Thevenin and Norton equivalent of what the netlist describes.
import type { Field, ToolSpec } from '../spec';
import { eng, fail, fmt, need, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Plot, Values } from '../shared';
import { acSweep, findResonance, operatingPoint, thevenin, transient } from './analysis';
import { layoutOf } from './mna';
import { keepOnly, readDirectives } from './directives';
import { nodeIndex, parseNetlist } from './parse';
import type { Circuit } from './parse';
import { parseProbes } from './probes';

const NETLIST = `* RC low-pass: a 1 V step for the transient and a 1 V AC source for the sweep
V1 in 0 STEP 0 1 0 AC 1 0
R1 in out 1k
C1 out 0 1u`;

const ANALYSES = ['netAc', 'netTran', 'netOp', 'netThev'] as const;
const KEY_OF: Record<string, string> = { netAc: 'ac', netTran: 'tran', netOp: 'op', netThev: 'thev' };
const analysisOf = (v: Values): string => v.analysis ?? 'netAc';
const when =
  (...keys: string[]) =>
  (v: Values): boolean =>
    keys.includes(KEY_OF[analysisOf(v)] ?? 'ac');

const FIELDS: readonly Field[] = [
  {
    id: 'analysis',
    label: 'netAnalysis',
    initial: 'netAc',
    kind: 'select',
    options: ANALYSES.map((value) => ({ value, label: value as Field['label'] })),
  },
  { id: 'netlist', label: 'netlistText', initial: NETLIST, kind: 'area', hint: 'netlistHint' },
  { id: 'keep', label: 'keepSource', initial: '', hint: 'keepHint' },
  { id: 'probes', label: 'probesText', initial: 'out', hint: 'probesHint', when: when('ac', 'tran') },
  { id: 'acStart', label: 'acStart', initial: '10', unit: 'Hz', when: when('ac') },
  { id: 'acStop', label: 'acStop', initial: '100k', unit: 'Hz', when: when('ac') },
  { id: 'acPoints', label: 'acPoints', initial: '200', when: when('ac') },
  { id: 'tranStep', label: 'tranStep', initial: '10u', unit: 's', when: when('tran') },
  { id: 'tranStop', label: 'tranStop', initial: '5m', unit: 's', when: when('tran') },
  { id: 'thevA', label: 'thevA', initial: 'out', when: when('thev') },
  { id: 'thevB', label: 'thevB', initial: '0', when: when('thev') },
];

const ascii = (v: number): string => fmt(v, 5).replace('−', '-');
const pretty = (name: string): string => `\\mathrm{${name.replace(/[^A-Za-z0-9]/g, '')}}`;

/** The system A x = z as LaTeX, for circuits small enough to read. */
function matrixStep(sys: { re: number[][]; zr: number[] }, labels: string[]): KitStep[] {
  if (labels.length > 6) return [];
  const rows = sys.re.map((row) => row.map((v) => ascii(v)).join(' & ')).join(' \\\\ ');
  const column = (items: string[]) => `\\begin{bmatrix} ${items.join(' \\\\ ')} \\end{bmatrix}`;
  const names = labels.map((l) =>
    l.startsWith('v(') ? `v_{${pretty(l.slice(2, -1))}}` : `i_{${pretty(l.slice(2, -1))}}`,
  );
  return [
    {
      key: 'netMatrix',
      math: `\\begin{bmatrix} ${rows} \\end{bmatrix} ${column(names)} = ${column(sys.zr.map((v) => ascii(v)))}`,
    },
  ];
}

function operating(circuit: Circuit, code: string): KitOk {
  const op = operatingPoint(circuit);
  const rows: KitRow[] = [
    ...circuit.nodes.map((name, i): KitRow => ({ key: 'nodeVoltage', vars: { name }, value: eng(op.x[i]!, 'V') })),
    ...circuit.elements
      .filter((e) => op.lay.branch.has(e.name.toLowerCase()))
      .map((e): KitRow => ({
        key: 'branchCurrent',
        vars: { name: e.name },
        value: eng(op.x[op.lay.branch.get(e.name.toLowerCase())!]!, 'A'),
      })),
    ...op.powers.map((p): KitRow => ({ key: 'elementPower', vars: { name: p.name }, value: eng(p.power, 'W') })),
    { key: 'powerBalance', value: eng(op.balance, 'W') },
  ];
  const first = circuit.nodes.slice(0, 3).map((name, i) => `v(${name}) = ${eng(op.x[i]!, 'V')}`);
  return ok({
    rows,
    steps: [
      { key: 'netUnknowns', vars: { list: op.lay.labels.join(', ') } },
      { key: 'netStamp' },
      ...matrixStep(op.system, op.lay.labels),
      { key: 'netSolved', vars: { count: String(op.lay.size) } },
      { key: 'netPower', vars: { value: eng(op.balance, 'W') } },
    ],
    answer: first.join(', '),
    latex: `A\\,x = z,\\quad ${circuit.nodes
      .slice(0, 3)
      .map((n, i) => `v_{${pretty(n)}} = ${ascii(op.x[i]!)}`)
      .join(',\\ ')}`,
    code,
    notes: ['netNote', 'netDcNote'],
  });
}

const db = (m: number): number => 20 * Math.log10(Math.max(m, 1e-300));

/** Phase with the jumps of 360 degrees taken out, so a plot does not leap. */
function unwrap(phase: number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  phase.forEach((p, i) => {
    if (i > 0) {
      const jump = p + offset - out[i - 1]!;
      if (jump > 180) offset -= 360;
      else if (jump < -180) offset += 360;
    }
    out.push(p + offset);
  });
  return out;
}

function acCase(circuit: Circuit, values: Values, code: string): KitOk {
  const lay = layoutOf(circuit);
  const probes = parseProbes(circuit, lay, values.probes ?? '');
  const start = positive(values, 'acStart', 'acStart', 'Hz');
  const stop = positive(values, 'acStop', 'acStop', 'Hz');
  const points = need(values, 'acPoints', 'acPoints');
  const sweep = acSweep(circuit, lay, probes, start, stop, points);
  const res = findResonance(circuit, lay, probes[0]!, sweep);
  const last = sweep.freqs.length - 1;
  const edge = (k: number, i: number): string => {
    const unit = probes[k]!.unit;
    return `${eng(sweep.freqs[i]!, 'Hz')}: ${eng(sweep.mag[k]![i]!, unit)} ∠ ${fmt(sweep.phase[k]![i]!, 4)}°`;
  };
  const rows: KitRow[] = probes.map((p, k): KitRow => ({
    key: 'acGain',
    vars: { probe: p.label },
    value: `${edge(k, 0)}; ${edge(k, last)}`,
  }));
  const steps: KitStep[] = [
    { key: 'netAcStep', math: 'Z_R = R,\\quad Z_L = j\\omega L,\\quad Z_C = \\frac{1}{j\\omega C}' },
    { key: 'netAcSolve', vars: { count: String(sweep.freqs.length) } },
  ];
  let answer = `${probes[0]!.label}: `;
  if (res.q !== null && res.bandwidth !== null) {
    rows.push(
      { key: 'resonantHz', value: eng(res.f0, 'Hz') },
      { key: 'peakResponse', vars: { probe: probes[0]!.label }, value: eng(res.peak, probes[0]!.unit) },
      { key: 'bandwidth', value: eng(res.bandwidth, 'Hz') },
      { key: 'qualityFactor', value: fmt(res.q) },
    );
    steps.push({ key: 'netPeak', vars: { f0: eng(res.f0, 'Hz'), q: fmt(res.q) }, math: 'Q = \\frac{f_0}{f_2 - f_1}' });
    answer += `peak at ${eng(res.f0, 'Hz')}, Q = ${fmt(res.q)}`;
  } else if (res.cutoff !== null) {
    rows.push({ key: 'cutoff3db', value: eng(res.cutoff, 'Hz') });
    steps.push({ key: 'netCutoff', vars: { value: eng(res.cutoff, 'Hz') } });
    answer += `${res.lowpass ? 'low-pass' : 'high-pass'}, −3 dB at ${eng(res.cutoff, 'Hz')}`;
  } else {
    answer += 'no peak or cutoff in this range';
  }
  const magnitude: Plot = {
    xLabel: 'f (Hz)',
    yLabel: 'Magnitude (dB)',
    logX: true,
    series: probes.map((p, k) => ({ name: p.label, x: sweep.freqs, y: sweep.mag[k]!.map(db) })),
  };
  const phase: Plot = {
    xLabel: 'f (Hz)',
    yLabel: 'Phase (degrees)',
    logX: true,
    series: probes.map((p, k) => ({ name: p.label, x: sweep.freqs, y: unwrap(sweep.phase[k]!) })),
  };
  return ok({
    rows,
    steps,
    answer,
    latex: res.q !== null ? `f_0 = ${ascii(res.f0)}\\ \\mathrm{Hz},\\quad Q = ${ascii(res.q)}` : undefined,
    plot: magnitude,
    plot2: phase,
    code,
    notes: ['netNote', 'netAcNote'],
  });
}

/** At most `limit` evenly chosen indices that include both ends. */
function thin(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: limit }, (_, i) => Math.round((i * (count - 1)) / (limit - 1)));
}

function tranCase(circuit: Circuit, values: Values, code: string): KitOk {
  const lay = layoutOf(circuit);
  const probes = parseProbes(circuit, lay, values.probes ?? '');
  const step = positive(values, 'tranStep', 'tranStep', 's');
  const stop = positive(values, 'tranStop', 'tranStop', 's');
  const run = transient(circuit, lay, probes, step, stop);
  const rows: KitRow[] = [{ key: 'tranPoints', value: String(run.t.length - 1) }];
  probes.forEach((p, k) => {
    const v = run.values[k]!;
    const hi = v.indexOf(Math.max(...v));
    const lo = v.indexOf(Math.min(...v));
    rows.push(
      { key: 'tranFinal', vars: { probe: p.label }, value: eng(v[v.length - 1]!, p.unit) },
      { key: 'tranMax', vars: { probe: p.label }, value: `${eng(v[hi]!, p.unit)} at ${eng(run.t[hi]!, 's')}` },
      { key: 'tranMin', vars: { probe: p.label }, value: `${eng(v[lo]!, p.unit)} at ${eng(run.t[lo]!, 's')}` },
    );
  });
  const keep = thin(run.t.length, 600);
  const first = probes[0]!;
  const last = run.values[0]![run.t.length - 1]!;
  return ok({
    rows,
    steps: [
      { key: 'netTranStart' },
      {
        key: 'netTranStep',
        math: 'i_C = \\frac{2C}{h}(v_n - v_{n-1}) - i_{n-1},\\quad v_L = \\frac{2L}{h}(i_n - i_{n-1}) - v_{n-1}',
      },
    ],
    answer: `${first.label}(${eng(stop, 's')}) = ${eng(last, first.unit)}`,
    latex: `${pretty(first.label)}(${ascii(stop)}\\,\\mathrm{s}) = ${ascii(last)}`,
    plot: {
      xLabel: 't (s)',
      yLabel: probes.every((p) => p.unit === 'V')
        ? 'Voltage (V)'
        : probes.every((p) => p.unit === 'A')
          ? 'Current (A)'
          : 'Voltage (V) or current (A)',
      series: probes.map((p, k) => ({
        name: p.label,
        x: keep.map((i) => run.t[i]!),
        y: keep.map((i) => run.values[k]![i]!),
      })),
    },
    code,
    notes: ['netNote', 'netTranNote'],
  });
}

function theveninCase(circuit: Circuit, values: Values, code: string): KitOk {
  const read = (id: string): number => {
    const name = (values[id] ?? '').trim();
    const at = nodeIndex(circuit, name);
    return at === null ? fail('netNode', { name }) : at;
  };
  const a = read('thevA');
  const b = read('thevB');
  if (a === b) fail('netSameNode');
  const eq = thevenin(circuit, a, b);
  const rows: KitRow[] = [
    { key: 'thVoltage', value: eng(eq.vth, 'V') },
    { key: 'thResistance', value: eng(eq.rth, 'Ω') },
    { key: 'nortonCurrent', value: eng(eq.norton, 'A') },
    { key: 'maxPowerRow', value: eng(eq.maxPower, 'W') },
    { key: 'loadForMax', value: eng(eq.rth, 'Ω') },
  ];
  return ok({
    rows,
    steps: [
      { key: 'netThev1', vars: { value: eng(eq.vth, 'V') }, math: 'V_{th} = v_a - v_b\\ \\text{(terminals open)}' },
      { key: 'netThev2', vars: { value: eng(eq.rth, 'Ω') }, math: 'R_{th} = \\frac{v_{test}}{1\\,\\mathrm{A}}' },
      { key: 'netNorton', vars: { value: eng(eq.norton, 'A') }, math: 'I_N = \\frac{V_{th}}{R_{th}}' },
      { key: 'netMaxPower', vars: { value: eng(eq.maxPower, 'W') }, math: 'P_{max} = \\frac{V_{th}^2}{4R_{th}}' },
    ],
    answer: `Vth = ${eng(eq.vth, 'V')}, Rth = ${eng(eq.rth, 'Ω')}, IN = ${eng(eq.norton, 'A')}`,
    latex: `V_{th} = ${ascii(eq.vth)}\\ \\mathrm{V},\\quad R_{th} = ${ascii(eq.rth)}\\ \\Omega`,
    code,
    notes: ['netNote', 'netThevNote'],
  });
}

export const spec: ToolSpec = {
  id: 'netlist',
  fields: FIELDS,
  run: (form) => {
    const text = form.netlist ?? '';
    // Lines such as .tran 10u 5m choose the analysis and its numbers, the same as the form fields.
    const directives = readDirectives(text);
    const values: Values = {
      ...form,
      ...directives.fields,
      ...(directives.analysis ? { analysis: directives.analysis } : {}),
    };
    const parsed = parseNetlist(directives.text);
    const only = (values.keep ?? '').trim();
    const circuit = only === '' ? parsed : keepOnly(parsed, only);
    switch (KEY_OF[analysisOf(values)]) {
      case 'op':
        return operating(circuit, text);
      case 'tran':
        return tranCase(circuit, values, text);
      case 'thev':
        return theveninCase(circuit, values, text);
      default:
        return acCase(circuit, values, text);
    }
  },
};
