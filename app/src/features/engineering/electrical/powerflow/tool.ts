// The power flow and economic dispatch tool: load flow by Newton-Raphson, Gauss-Seidel, or the DC approximation, and
// the cheapest split of a demand between generators.
import type { Field, ToolSpec } from '../spec';
import { eng, fmt, ok, positive, toDegrees } from '../shared';
import type { Cx, KitOk, KitRow, KitStep, Values } from '../shared';
import { dcFlow, economicDispatch, gaussSeidel, lineFlows, newtonRaphson, parseNetwork, parseUnits } from './engine';
import type { FlowResult, Network } from './engine';

const MODES = ['newton', 'gauss', 'dc', 'dispatch'] as const;
const modeOf = (v: Values): string => v.mode ?? 'newton';
const flow = (v: Values): boolean => modeOf(v) !== 'dispatch';

const NETWORK = `# Per-unit network. slack: bus, V, angle. gen: bus, P, V. load: bus, P, Q. line: from, to, R, X, B.
slack 1 1.02 0
gen 2 0.4 1.01
line 1 2 0.02 0.08 0.02
line 1 3 0.01 0.05
line 2 3 0.015 0.06
load 2 0.2 0.1
load 3 0.8 0.3`;

const UNITS = `# Cost = a P^2 + b P + c, with P in MW. unit: a, b, c, least MW, most MW.
unit 0.004 5 0 0 400
unit 0.006 4 0 0 400`;

const FIELDS: readonly Field[] = [
  {
    id: 'mode',
    label: 'pfMode',
    initial: 'newton',
    kind: 'select',
    options: MODES.map((value) => ({ value, label: value as Field['label'] })),
  },
  { id: 'network', label: 'networkText', initial: NETWORK, kind: 'area', hint: 'networkHint', when: flow },
  { id: 'base', label: 'baseMva', initial: '100', unit: 'MVA', when: flow },
  { id: 'units', label: 'unitsText', initial: UNITS, kind: 'area', hint: 'unitsHint', when: (v) => !flow(v) },
  { id: 'demand', label: 'demandMw', initial: '500', unit: 'MW', when: (v) => !flow(v) },
];

/** A complex number for a LaTeX matrix: "1.2-j9.6". */
function cell(c: Cx): string {
  const re = Math.abs(c.re) < 1e-12 ? '' : fmt(c.re, 4).replace('−', '-');
  const im = Math.abs(c.im) < 1e-12 ? '' : `${c.im < 0 ? '-' : re === '' ? '' : '+'}j${fmt(Math.abs(c.im), 4)}`;
  return re + im === '' ? '0' : re + im;
}

const polar = (m: number, theta: number): string => `${fmt(m, 5)} ∠ ${fmt(toDegrees(theta), 4)}°`;
const pq = (s: Cx, digits = 4): string =>
  `${fmt(s.re, digits)} ${s.im < 0 ? '−' : '+'} j${fmt(Math.abs(s.im), digits)}`;

function ybusStep(y: Cx[][]): KitStep[] {
  if (y.length > 6) return [];
  const body = y.map((row) => row.map(cell).join(' & ')).join(' \\\\ ');
  return [{ key: 'pfYbus', math: `Y = \\begin{bmatrix} ${body} \\end{bmatrix}` }];
}

function loadFlow(values: Values, net: Network, gauss: boolean): KitOk {
  const base = positive(values, 'base', 'baseMva', 'MVA');
  const r: FlowResult = gauss ? gaussSeidel(net) : newtonRaphson(net);
  const flows = lineFlows(net, r);
  const rows: KitRow[] = [
    { key: 'pfIterations', value: String(r.iterations) },
    ...net.buses.map((b, i): KitRow => ({
      key: 'busRow',
      vars: { n: String(b.id) },
      value: polar(r.v[i]!, r.theta[i]!),
    })),
  ];
  const slack = net.buses.findIndex((b) => b.type === 'slack');
  rows.push({
    key: 'slackSupplies',
    value: `${fmt(r.p[slack]! + net.buses[slack]!.pl)} + j${fmt(r.q[slack]! + net.buses[slack]!.ql)} pu = ${eng(
      (r.p[slack]! + net.buses[slack]!.pl) * base * 1e6,
      'W',
    )}`,
  });
  flows.forEach((f) => {
    rows.push({
      key: 'lineFlow',
      vars: { a: String(f.from), b: String(f.to) },
      value: `${pq(f.sFrom)} pu (${fmt(f.sFrom.re * base)} MW); loss ${fmt(f.loss.re * base)} MW`,
    });
  });
  const lossTotal = flows.reduce((s, f) => s + f.loss.re, 0);
  rows.push({ key: 'totalLoss', value: `${fmt(lossTotal)} pu = ${fmt(lossTotal * base)} MW` });
  r.history.forEach((worst, i) =>
    rows.push({ key: 'mismatchRow', vars: { n: String(i) }, value: `${fmt(worst, 3)} pu` }),
  );
  const steps: KitStep[] = [
    ...ybusStep(r.y),
    gauss
      ? {
          key: 'pfGauss',
          math: 'V_i^{(k+1)} = \\frac{1}{Y_{ii}}\\left[\\frac{P_i - jQ_i}{(V_i^{(k)})^*} - \\sum_{j \\ne i} Y_{ij}V_j\\right]',
        }
      : {
          key: 'pfNewton',
          math: '\\begin{bmatrix}\\Delta P \\\\ \\Delta Q\\end{bmatrix} = J\\begin{bmatrix}\\Delta\\theta \\\\ \\Delta |V|\\end{bmatrix}',
        },
    {
      key: 'pfMismatch',
      vars: { first: fmt(r.history[0]!, 3), last: fmt(r.history[r.history.length - 1]!, 3), n: String(r.iterations) },
      math: '\\Delta P_i = P_i^{sched} - \\sum_k |V_i||V_k|(G_{ik}\\cos\\theta_{ik} + B_{ik}\\sin\\theta_{ik})',
    },
    { key: 'pfLineFlow', math: 'S_{ij} = V_i\\,I_{ij}^*,\\quad I_{ij} = (V_i - V_j)\\,y_{ij} + V_i\\,\\frac{jB}{2}' },
    { key: 'pfLossStep', vars: { value: `${fmt(lossTotal * base)} MW` } },
  ];
  return ok({
    rows,
    steps,
    answer:
      net.buses.map((b, i) => `V${b.id} = ${polar(r.v[i]!, r.theta[i]!)}`).join('; ') +
      `; losses ${fmt(lossTotal * base)} MW`,
    latex: `\\text{losses} = ${fmt(lossTotal).replace('−', '-')}\\ \\mathrm{pu}`,
    notes: gauss ? ['pfNote', 'gaussNote'] : ['pfNote'],
  });
}

function dcCase(values: Values, net: Network): KitOk {
  const base = positive(values, 'base', 'baseMva', 'MVA');
  const d = dcFlow(net);
  const rows: KitRow[] = [
    ...net.buses.map((b, i): KitRow => ({
      key: 'angleRow',
      vars: { n: String(b.id) },
      value: `${fmt(toDegrees(d.theta[i]!), 5)}°`,
    })),
    ...net.lines.map((l, i): KitRow => ({
      key: 'dcFlow',
      vars: { a: String(l.from), b: String(l.to) },
      value: `${fmt(d.flows[i]!)} pu = ${fmt(d.flows[i]! * base)} MW`,
    })),
    { key: 'slackSupplies', value: `${fmt(d.slackPower)} pu = ${fmt(d.slackPower * base)} MW` },
  ];
  return ok({
    rows,
    steps: [
      { key: 'dcSetup', math: "B'\\,\\theta = P,\\quad B'_{ii} = \\sum \\frac{1}{x},\\ B'_{ij} = -\\frac{1}{x_{ij}}" },
      { key: 'dcFlowStep', math: 'P_{ij} = \\frac{\\theta_i - \\theta_j}{x_{ij}}' },
    ],
    answer: net.lines.map((l, i) => `P${l.from}-${l.to} = ${fmt(d.flows[i]! * base)} MW`).join('; '),
    latex: 'P_{ij} = \\frac{\\theta_i - \\theta_j}{x_{ij}}',
    notes: ['dcNote'],
  });
}

function dispatchCase(values: Values): KitOk {
  const units = parseUnits(values.units ?? '');
  const demand = positive(values, 'demand', 'demandMw', 'MW');
  const d = economicDispatch(units, demand);
  const outputs = d.p.map((x, i) => `P${i + 1} = ${fmt(x, 6)} MW`).join(', ');
  const rows: KitRow[] = [
    ...units.map((_, i): KitRow => ({
      key: 'dispatchUnit',
      vars: { n: String(i + 1) },
      value: `${fmt(d.p[i]!, 6)} MW${d.limit[i] ? ` (${d.limit[i] === 'max' ? 'at its upper limit' : 'at its lower limit'})` : ''}`,
    })),
    { key: 'lambdaRow', value: `${fmt(d.lambda, 6)} per MWh` },
    { key: 'totalCost', value: `${fmt(d.cost, 8)} per hour` },
    {
      key: 'totalOutput',
      value: `${fmt(
        d.p.reduce((s, x) => s + x, 0),
        8,
      )} MW`,
    },
  ];
  return ok({
    rows,
    steps: [
      { key: 'dispatchEqual', math: '\\frac{dC_i}{dP_i} = 2a_iP_i + b_i = \\lambda' },
      { key: 'dispatchSum', vars: { value: fmt(d.lambda, 6) }, math: '\\sum_i P_i = P_{demand}' },
      { key: 'dispatchLimits' },
      { key: 'dispatchCost', vars: { value: fmt(d.cost, 8) }, math: 'C = \\sum_i (a_iP_i^2 + b_iP_i + c_i)' },
    ],
    answer: `${outputs}; λ = ${fmt(d.lambda, 6)} per MWh; cost ${fmt(d.cost, 8)} per hour`,
    latex: `\\lambda = ${fmt(d.lambda, 6).replace('−', '-')},\\quad C = ${fmt(d.cost, 8).replace('−', '-')}`,
    notes: ['dispatchNote'],
  });
}

export const spec: ToolSpec = {
  id: 'powerflow',
  fields: FIELDS,
  run: (values) => {
    const mode = modeOf(values);
    if (mode === 'dispatch') return dispatchCase(values);
    const net = parseNetwork(values.network ?? '');
    if (mode === 'dc') return dcCase(values, net);
    return loadFlow(values, net, mode === 'gauss');
  },
};
