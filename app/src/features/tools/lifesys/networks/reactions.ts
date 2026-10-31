// Reaction networks typed as reactions, one per line, such as "A + B -> C, 0.5". A rate is a mass-action constant, or
// mm(Vmax, Km) on the one reactant, or rep(X, V, K, n) and act(X, V, K, n) for production repressed or activated by
// X. The text is parsed, never run. Networks are solved as ODEs (Dormand-Prince) and by Gillespie's direct method
// over seeded runs, with the mean and a 5-95% band. Amounts are counts in a volume of 1.
import { LsError, positive, whole, within } from '../num/errors';
import { dopri } from '../num/ode';
import { createRng } from '../num/rng';
import type { CalcResult, Series } from '../types';

type Point = [number, number];

export type Rate =
  | { kind: 'mass'; k: number }
  | { kind: 'mm'; vmax: number; km: number }
  | { kind: 'rep' | 'act'; on: string; v: number; k: number; n: number };

export interface Reaction {
  reactants: Record<string, number>;
  products: Record<string, number>;
  rate: Rate;
}

export interface Network {
  species: string[];
  reactions: Reaction[];
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function side(text: string, line: number): Record<string, number> {
  const out: Record<string, number> = {};
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '0' || trimmed === '∅') return out;
  for (const term of trimmed.split('+')) {
    const m = /^\s*(\d*)\s*([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(term);
    if (!m) throw new LsError('networks.e.term', { line, term: term.trim() });
    const count = m[1] === '' ? 1 : Number(m[1]);
    if (!(count >= 1)) throw new LsError('networks.e.term', { line, term: term.trim() });
    out[m[2]] = (out[m[2]] ?? 0) + count;
  }
  return out;
}

function parseRate(text: string, line: number, reactants: Record<string, number>): Rate {
  const t = text.trim();
  const call = /^(mm|rep|act)\s*\(([^)]*)\)$/i.exec(t);
  if (!call) {
    const k = Number(t);
    if (t === '' || !Number.isFinite(k) || k < 0) throw new LsError('networks.e.rate', { line });
    return { kind: 'mass', k };
  }
  const args = call[2].split(',').map((a) => a.trim());
  const kind = call[1].toLowerCase();
  if (kind === 'mm') {
    const [vmax, km] = args.map(Number);
    if (args.length !== 2 || !(vmax >= 0) || !(km > 0)) throw new LsError('networks.e.rate', { line });
    if (Object.keys(reactants).length !== 1 || Object.values(reactants)[0] !== 1)
      throw new LsError('networks.e.mm', { line });
    return { kind: 'mm', vmax, km };
  }
  const [on, ...rest] = args;
  const [v, k, n] = rest.map(Number);
  if (args.length !== 4 || !NAME.test(on) || !(v >= 0) || !(k > 0) || !(n > 0))
    throw new LsError('networks.e.rate', { line });
  return { kind: kind as 'rep' | 'act', on, v, k, n };
}

/** Parses the reaction lines; blank lines and lines starting with # are skipped. */
export function parseNetwork(text: string): Network {
  const reactions: Reaction[] = [];
  const species = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineText = raw.trim();
    if (lineText === '' || lineText.startsWith('#')) return;
    const line = i + 1;
    const arrow = lineText.indexOf('->');
    const comma = lineText.lastIndexOf(',');
    if (arrow < 0 || comma < arrow) throw new LsError('networks.e.line', { line });
    // The rate may hold commas inside parentheses: split at the first comma after the arrow outside them.
    let depth = 0;
    let cut = -1;
    for (let j = arrow + 2; j < lineText.length; j += 1) {
      if (lineText[j] === '(') depth += 1;
      else if (lineText[j] === ')') depth -= 1;
      else if (lineText[j] === ',' && depth === 0) {
        cut = j;
        break;
      }
    }
    if (cut < 0) throw new LsError('networks.e.line', { line });
    const reactants = side(lineText.slice(0, arrow), line);
    const products = side(lineText.slice(arrow + 2, cut), line);
    const rate = parseRate(lineText.slice(cut + 1), line, reactants);
    for (const s of [...Object.keys(reactants), ...Object.keys(products)]) species.add(s);
    if (rate.kind === 'rep' || rate.kind === 'act') species.add(rate.on);
    reactions.push({ reactants, products, rate });
  });
  if (reactions.length === 0) throw new LsError('networks.e.noReactions');
  if (reactions.length > 40) throw new LsError('errors.range', { name: 'reactions', low: 1, high: 40 });
  return { species: [...species], reactions };
}

const hillUp = (x: number, k: number, n: number) => (x <= 0 ? 0 : x ** n / (k ** n + x ** n));

/** The deterministic rate of a reaction (mass action with concentrations). */
export function odeRate(r: Reaction, x: Record<string, number>): number {
  if (r.rate.kind === 'mass') {
    let v = r.rate.k;
    for (const [s, c] of Object.entries(r.reactants)) v *= Math.max(x[s], 0) ** c;
    return v;
  }
  if (r.rate.kind === 'mm') {
    const s = Math.max(x[Object.keys(r.reactants)[0]], 0);
    return (r.rate.vmax * s) / (r.rate.km + s);
  }
  const h = hillUp(Math.max(x[r.rate.on], 0), r.rate.k, r.rate.n);
  return r.rate.v * (r.rate.kind === 'act' ? h : 1 - h);
}

/** The stochastic propensity: mass action counts distinct molecule combinations, k x(x − 1)… for repeats. */
export function propensity(r: Reaction, x: Record<string, number>): number {
  if (r.rate.kind !== 'mass') return odeRate(r, x);
  let a = r.rate.k;
  for (const [s, c] of Object.entries(r.reactants)) for (let j = 0; j < c; j += 1) a *= Math.max(x[s] - j, 0);
  return a;
}

export function solveOde(net: Network, init: Record<string, number>, tEnd: number) {
  const sp = net.species;
  const change = net.reactions.map((r) => sp.map((s) => (r.products[s] ?? 0) - (r.reactants[s] ?? 0)));
  return dopri(
    (_, y) => {
      const x = Object.fromEntries(sp.map((s, i) => [s, y[i]]));
      const d = sp.map(() => 0);
      net.reactions.forEach((r, j) => {
        const v = odeRate(r, x);
        for (let i = 0; i < sp.length; i += 1) d[i] += change[j][i] * v;
      });
      return d;
    },
    sp.map((s) => init[s] ?? 0),
    0,
    tEnd,
    { maxStep: tEnd / 300 },
  );
}

/** Gillespie's direct method: `runs` seeded runs recorded at `points` + 1 evenly spaced times. */
export function gillespie(
  net: Network,
  init: Record<string, number>,
  tEnd: number,
  runs: number,
  seed: number,
  points = 100,
) {
  const rng = createRng(seed);
  const sp = net.species;
  const grid = Array.from({ length: points + 1 }, (_, i) => (tEnd * i) / points);
  const values = sp.map(() => grid.map(() => new Float64Array(runs)));
  let events = 0;
  for (let run = 0; run < runs; run += 1) {
    const x: Record<string, number> = Object.fromEntries(sp.map((s) => [s, Math.round(init[s] ?? 0)]));
    let t = 0;
    let g = 0;
    for (;;) {
      const a = net.reactions.map((r) => propensity(r, x));
      const a0 = a.reduce((s, v) => s + v, 0);
      const dt = a0 > 0 ? -Math.log(1 - rng.next()) / a0 : Infinity;
      while (g <= points && grid[g] < t + dt) {
        sp.forEach((s, i) => (values[i][g][run] = x[s]));
        g += 1;
      }
      if (g > points) break;
      t += dt;
      let pick = rng.next() * a0;
      let j = 0;
      while (j < a.length - 1 && pick >= a[j]) {
        pick -= a[j];
        j += 1;
      }
      const r = net.reactions[j];
      for (const [s, c] of Object.entries(r.reactants)) x[s] -= c;
      for (const [s, c] of Object.entries(r.products)) x[s] += c;
      events += 1;
      if (events > 5_000_000) throw new LsError('networks.e.events');
    }
  }
  const stat = (arr: Float64Array) => {
    const sorted = Array.from(arr).sort((p, q) => p - q);
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    return { mean: sorted.reduce((s, v) => s + v, 0) / sorted.length, low: q(0.05), high: q(0.95) };
  };
  return { grid, stats: values.map((perSpecies) => perSpecies.map(stat)), events };
}

export function reactionResult(
  text: string,
  initRows: { labels: string[]; rows: number[][] },
  tEnd: number,
  method: 'ode' | 'ssa' | 'both',
  runs: number,
  seed: number,
): CalcResult {
  const net = parseNetwork(text);
  positive(tEnd, 't');
  const init: Record<string, number> = {};
  initRows.labels.forEach((name, i) => {
    if (!NAME.test(name)) throw new LsError('networks.e.initName', { name });
    const v = initRows.rows[i][0];
    if (!(v >= 0)) throw new LsError('errors.nonNegative', { name });
    init[name] = v;
  });
  for (const name of Object.keys(init))
    if (!net.species.includes(name)) throw new LsError('networks.e.unknownSpecies', { name });
  const series: Series[] = [];
  const rows: CalcResult['rows'] = [];
  const steps: CalcResult['steps'] = [
    {
      key: 'networks.s.parsed',
      vars: { r: net.reactions.length, s: net.species.length, names: net.species.join(', ') },
    },
  ];
  if (method !== 'ssa') {
    const sol = solveOde(net, init, tEnd);
    const last = sol.y[sol.y.length - 1];
    net.species.forEach((s, i) => {
      rows.push({ label: 'networks.r.odeAt', vars: { s, t: tEnd }, value: last[i] });
      series.push({
        name: 'networks.p.odeSeries',
        vars: { s },
        points: sol.t.map((t, k) => [t, sol.y[k][i]] as Point),
      });
    });
    steps.push({ key: 'networks.s.ode', vars: { n: sol.t.length } });
  }
  if (method !== 'ode') {
    whole(runs, 'runs', 1);
    within(runs, 'runs', 1, 2000);
    const ssa = gillespie(net, init, tEnd, runs, seed);
    net.species.forEach((s, i) => {
      const end = ssa.stats[i][ssa.grid.length - 1];
      rows.push({ label: 'networks.r.ssaAt', vars: { s, t: tEnd }, value: end.mean });
      series.push(
        {
          name: 'networks.p.ssaMean',
          vars: { s },
          style: 'dashed',
          points: ssa.grid.map((t, k) => [t, ssa.stats[i][k].mean] as Point),
        },
        {
          name: 'networks.p.ssaLow',
          vars: { s },
          style: 'outline',
          points: ssa.grid.map((t, k) => [t, ssa.stats[i][k].low] as Point),
        },
        {
          name: 'networks.p.ssaHigh',
          vars: { s },
          style: 'outline',
          points: ssa.grid.map((t, k) => [t, ssa.stats[i][k].high] as Point),
        },
      );
    });
    rows.push({ label: 'networks.r.seed', value: seed });
    steps.push({ key: 'networks.s.ssa', vars: { runs, seed, e: ssa.events } });
  }
  return {
    rows,
    steps,
    latex: '\\frac{d\\mathbf{x}}{dt} = N \\mathbf{v}(\\mathbf{x})',
    notes: [{ key: 'networks.n.reactions' }],
    plots: [
      {
        title: 'networks.p.reactions',
        x: { label: 'networks.p.time' },
        y: { label: 'networks.p.amount', min: 0 },
        series,
      },
    ],
  };
}

/** Ready-made networks: the reaction lines and the starting amounts. */
export const PRESETS = {
  birthDeath: { text: 'N -> 2 N, 1\nN -> , 0.5', init: 'N 10', t: 2 },
  gene: { text: '-> M, 2\nM -> M + P, 10\nM -> , 1\nP -> , 0.1', init: 'M 0\nP 0', t: 50 },
  toggle: { text: '-> U, rep(V, 50, 10, 2)\n-> V, rep(U, 50, 10, 2)\nU -> , 1\nV -> , 1', init: 'U 40\nV 5', t: 30 },
  repressilator: {
    text: '-> A, rep(C, 50, 10, 3)\n-> B, rep(A, 50, 10, 3)\n-> C, rep(B, 50, 10, 3)\nA -> , 1\nB -> , 1\nC -> , 1',
    init: 'A 20\nB 5\nC 1',
    t: 40,
  },
  enzyme: { text: 'E + S -> C, 0.01\nC -> E + S, 0.1\nC -> E + P, 0.5', init: 'E 20\nS 200\nC 0\nP 0', t: 30 },
  lotka: { text: 'X -> 2 X, 1\nX + Y -> 2 Y, 0.01\nY -> , 1', init: 'X 100\nY 50', t: 20 },
  box: { text: '-> L, 5\nL -> , 0.1\nL -> S, 0.05\nS -> , 0.01', init: 'L 0\nS 0', t: 100 },
} as const;
export type Preset = keyof typeof PRESETS;
