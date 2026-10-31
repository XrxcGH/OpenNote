// Agent-based and cellular models on a square grid that wraps at the edges (a torus), each seeded: Schelling
// segregation, SIR on a lattice, the voter model, Conway's Life, Wolfram's elementary cellular automata, and
// Granovetter's threshold model of collective behavior.
import { LsError, whole, within } from '../num/errors';
import { createRng, type Rng } from '../num/rng';
import type { CalcResult, Series } from '../types';

type Point = [number, number];
const MOORE = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const VON = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** The cells of a grid as points (column, row) for each value in `values`, for a picture of the grid. */
function cells(grid: readonly number[], n: number, value: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < grid.length; i += 1) if (grid[i] === value) out.push([i % n, n - 1 - Math.floor(i / n)]);
  return out;
}

function sizeCheck(n: number) {
  whole(n, 'n', 3);
  within(n, 'n', 3, 200);
}

// ---- Schelling --------------------------------------------------------------------------------------------------

/** 0 is empty; 1 and 2 are the groups. Each occupied cell's share of like neighbors, or 1 with no neighbors. */
function likeShares(grid: readonly number[], n: number): number[] {
  return grid.map((g, i) => {
    if (g === 0) return NaN;
    let like = 0;
    let all = 0;
    const r = Math.floor(i / n);
    const c = i % n;
    for (const [dr, dc] of MOORE) {
      const h = grid[wrap(r + dr, n) * n + wrap(c + dc, n)];
      if (h !== 0) {
        all += 1;
        if (h === g) like += 1;
      }
    }
    return all === 0 ? 1 : like / all;
  });
}

const meanOf = (xs: number[]) => {
  const v = xs.filter((x) => !Number.isNaN(x));
  return v.reduce((s, x) => s + x, 0) / v.length;
};

export function schelling(n: number, empty: number, tolerance: number, seed: number, maxSteps: number) {
  const rng = createRng(seed);
  const count = n * n;
  const blanks = Math.round(empty * count);
  const filled = count - blanks;
  const start = rng.shuffle(
    Array.from({ length: count }, (_, i) => (i < blanks ? 0 : i < blanks + Math.ceil(filled / 2) ? 1 : 2)),
  );
  const grid = [...start];
  const history: Point[] = [[0, meanOf(likeShares(grid, n))]];
  let step = 0;
  let settled = false;
  for (; step < maxSteps; step += 1) {
    const shares = likeShares(grid, n);
    const unhappy = shares.map((s, i) => (grid[i] !== 0 && s < tolerance ? i : -1)).filter((i) => i >= 0);
    if (unhappy.length === 0) {
      settled = true;
      break;
    }
    // Random sequential order: each unhappy agent in turn moves to a random empty cell.
    for (const i of rng.shuffle(unhappy)) {
      const empties = grid.map((g, k) => (g === 0 ? k : -1)).filter((k) => k >= 0);
      if (empties.length === 0) break;
      const to = empties[rng.int(empties.length)];
      grid[to] = grid[i];
      grid[i] = 0;
    }
    history.push([step + 1, meanOf(likeShares(grid, n))]);
  }
  return { start, grid, history, steps: step, settled };
}

export function schellingResult(
  n: number,
  empty: number,
  tolerance: number,
  seed: number,
  maxSteps: number,
): CalcResult {
  sizeCheck(n);
  within(empty, 'empty', 0.01, 0.9);
  within(tolerance, 'tolerance', 0, 1);
  whole(maxSteps, 'steps', 1);
  within(maxSteps, 'steps', 1, 1000);
  const s = schelling(n, empty, tolerance, seed, maxSteps);
  const before = s.history[0][1];
  const after = s.history[s.history.length - 1][1];
  return {
    rows: [
      { label: 'networks.r.likeBefore', value: 100 * before, unit: '%' },
      { label: 'networks.r.likeAfter', value: 100 * after, unit: '%' },
      { label: 'networks.r.rounds', value: s.steps },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: 'networks.s.schelling', vars: { n, e: 100 * empty, t: 100 * tolerance } },
      {
        key: s.settled ? 'networks.s.settled' : 'networks.s.capped',
        vars: { k: s.steps, b: 100 * before, a: 100 * after },
      },
    ],
    notes: [{ key: 'networks.n.schelling' }],
    plots: [
      {
        title: 'networks.p.schellingGrid',
        x: { label: 'networks.p.column' },
        y: { label: 'networks.p.row' },
        series: [
          { name: 'networks.p.groupA', style: 'points', points: cells(s.grid, n, 1) },
          { name: 'networks.p.groupB', style: 'outline', points: cells(s.grid, n, 2) },
        ],
      },
      {
        title: 'networks.p.similarity',
        x: { label: 'networks.p.round' },
        y: { label: 'networks.p.likeShare', min: 0, max: 1 },
        series: [{ name: 'networks.p.likeSeries', points: s.history }],
      },
    ],
  };
}

// ---- SIR on a lattice ---------------------------------------------------------------------------------------------

export function latticeSir(n: number, beta: number, gamma: number, seeds: number, seed: number, steps: number) {
  const rng = createRng(seed);
  // 0 susceptible, 1 infected, 2 recovered.
  let grid = new Array<number>(n * n).fill(0);
  for (const i of rng.shuffle(Array.from({ length: n * n }, (_, k) => k)).slice(0, seeds)) grid[i] = 1;
  const curve: { s: number; i: number; r: number }[] = [];
  const tally = () => {
    const c = { s: 0, i: 0, r: 0 };
    for (const g of grid) c[g === 0 ? 's' : g === 1 ? 'i' : 'r'] += 1;
    curve.push(c);
  };
  tally();
  for (let t = 0; t < steps && curve[curve.length - 1].i > 0; t += 1) {
    // Synchronous update: every cell looks at last step's grid.
    const next = [...grid];
    for (let k = 0; k < grid.length; k += 1) {
      if (grid[k] === 1) {
        if (rng.next() < gamma) next[k] = 2;
      } else if (grid[k] === 0) {
        const r = Math.floor(k / n);
        const c = k % n;
        let infected = 0;
        for (const [dr, dc] of VON) if (grid[wrap(r + dr, n) * n + wrap(c + dc, n)] === 1) infected += 1;
        if (infected > 0 && rng.next() < 1 - (1 - beta) ** infected) next[k] = 1;
      }
    }
    grid = next;
    tally();
  }
  return { curve, grid };
}

export function latticeSirResult(
  n: number,
  beta: number,
  gamma: number,
  seeds: number,
  seed: number,
  steps: number,
): CalcResult {
  sizeCheck(n);
  within(beta, 'β', 0, 1);
  within(gamma, 'γ', 0, 1);
  whole(seeds, 'I₀', 1);
  if (seeds >= n * n) throw new LsError('networks.e.i0');
  whole(steps, 'steps', 1);
  within(steps, 'steps', 1, 2000);
  const run = latticeSir(n, beta, gamma, seeds, seed, steps);
  const total = n * n;
  const end = run.curve[run.curve.length - 1];
  const peak = run.curve.reduce((b, c, i) => (c.i > run.curve[b].i ? i : b), 0);
  return {
    rows: [
      { label: 'networks.r.finalSize', value: (100 * (total - end.s)) / total, unit: '%' },
      { label: 'networks.r.peakI', value: run.curve[peak].i },
      { label: 'networks.r.peakTime', value: peak },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: 'networks.s.lattice', vars: { n, b: beta, g: gamma } },
      { key: 'networks.s.latticeEnd', vars: { t: run.curve.length - 1, f: (100 * (total - end.s)) / total } },
    ],
    notes: [{ key: 'networks.n.lattice' }],
    plots: [
      {
        title: 'networks.p.epidemic',
        x: { label: 'networks.p.step' },
        y: { label: 'networks.p.people', min: 0 },
        series: (['s', 'i', 'r'] as const).map((k, j) => ({
          name: (['networks.p.S', 'networks.p.I', 'networks.p.R'] as const)[j],
          style: (['line', 'dashed', 'outline'] as const)[j],
          points: run.curve.map((c, t) => [t, c[k]] as Point),
        })),
      },
      {
        title: 'networks.p.latticeGrid',
        x: { label: 'networks.p.column' },
        y: { label: 'networks.p.row' },
        series: [
          { name: 'networks.p.R', style: 'points', points: cells(run.grid, n, 2) },
          { name: 'networks.p.I', style: 'outline', points: cells(run.grid, n, 1) },
        ],
      },
    ],
  };
}

// ---- Voter model --------------------------------------------------------------------------------------------------

export function voterResult(n: number, seed: number, sweeps: number): CalcResult {
  sizeCheck(n);
  within(n, 'n', 3, 60);
  whole(sweeps, 'sweeps', 1);
  within(sweeps, 'sweeps', 1, 5000);
  const rng: Rng = createRng(seed);
  const grid = Array.from({ length: n * n }, () => rng.int(2));
  const share: Point[] = [[0, grid.reduce((s, g) => s + g, 0) / grid.length]];
  let consensus = -1;
  for (let sweep = 1; sweep <= sweeps; sweep += 1) {
    // One sweep is n² random sequential updates: a random cell copies a random neighbor.
    for (let u = 0; u < grid.length; u += 1) {
      const k = rng.int(grid.length);
      const [dr, dc] = VON[rng.int(4)];
      grid[k] = grid[wrap(Math.floor(k / n) + dr, n) * n + wrap((k % n) + dc, n)];
    }
    const f = grid.reduce((s, g) => s + g, 0) / grid.length;
    share.push([sweep, f]);
    if (f === 0 || f === 1) {
      consensus = sweep;
      break;
    }
  }
  const f = share[share.length - 1][1];
  return {
    rows: [
      { label: 'networks.r.opinionShare', value: 100 * f, unit: '%' },
      { label: 'networks.r.consensus', value: consensus >= 0 ? consensus : '—' },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: 'networks.s.voter', vars: { n } },
      consensus >= 0
        ? { key: 'networks.s.consensus', vars: { k: consensus } }
        : { key: 'networks.s.noConsensus', vars: { k: sweeps, f: 100 * f } },
    ],
    notes: [{ key: 'networks.n.voter' }],
    plots: [
      {
        title: 'networks.p.voter',
        x: { label: 'networks.p.sweep' },
        y: { label: 'networks.p.share', min: 0, max: 1 },
        series: [{ name: 'networks.p.opinion', points: share }],
      },
    ],
  };
}

// ---- Conway's Life ------------------------------------------------------------------------------------------------

export function lifeStep(grid: readonly number[], n: number): number[] {
  return grid.map((alive, k) => {
    const r = Math.floor(k / n);
    const c = k % n;
    let live = 0;
    for (const [dr, dc] of MOORE) live += grid[wrap(r + dr, n) * n + wrap(c + dc, n)];
    return live === 3 || (alive === 1 && live === 2) ? 1 : 0;
  });
}

export const PATTERNS: Record<string, readonly [number, number][]> = {
  blinker: [
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  glider: [
    [0, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  rPentomino: [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
};

/** Places a pattern (row, column) near the middle of an n × n grid. */
export function placed(pattern: readonly [number, number][], n: number): number[] {
  const grid = new Array<number>(n * n).fill(0);
  const off = Math.floor(n / 2) - 1;
  for (const [r, c] of pattern) grid[wrap(r + off, n) * n + wrap(c + off, n)] = 1;
  return grid;
}

/** The smallest p ≤ maxPeriod and shift (dr, dc) with step^p(grid) = grid moved by the shift, or null. */
export function periodOf(grid: readonly number[], n: number, maxPeriod = 30) {
  const live = (g: readonly number[]) => g.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
  const start = live(grid);
  if (start.length === 0) return null;
  let g = [...grid];
  for (let p = 1; p <= maxPeriod; p += 1) {
    g = lifeStep(g, n);
    const now = live(g);
    if (now.length !== start.length) continue;
    const dr = wrap(Math.floor(now[0] / n) - Math.floor(start[0] / n), n);
    const dc = wrap((now[0] % n) - (start[0] % n), n);
    const moved = new Set(start.map((k) => wrap(Math.floor(k / n) + dr, n) * n + wrap((k % n) + dc, n)));
    if (now.every((k) => moved.has(k))) {
      const signed = (d: number) => (d > n / 2 ? d - n : d);
      return { period: p, dr: signed(dr), dc: signed(dc) };
    }
  }
  return null;
}

export function lifeResult(n: number, pattern: string, density: number, seed: number, generations: number): CalcResult {
  sizeCheck(n);
  whole(generations, 'g', 1);
  within(generations, 'g', 1, 1000);
  let grid: number[];
  if (pattern === 'random') {
    within(density, 'density', 0, 1);
    const rng = createRng(seed);
    grid = Array.from({ length: n * n }, () => (rng.next() < density ? 1 : 0));
  } else grid = placed(PATTERNS[pattern] ?? PATTERNS.glider, n);
  const first = periodOf(grid, n);
  const population: Point[] = [[0, grid.reduce((s, v) => s + v, 0)]];
  for (let g = 1; g <= generations; g += 1) {
    grid = lifeStep(grid, n);
    population.push([g, grid.reduce((s, v) => s + v, 0)]);
  }
  const rows: CalcResult['rows'] = [
    { label: 'networks.r.alive', vars: { g: generations }, value: population[population.length - 1][1] },
  ];
  const steps: CalcResult['steps'] = [{ key: 'networks.s.life', vars: { n } }];
  if (first) {
    rows.push({ label: 'networks.r.period', value: first.period });
    steps.push(
      first.dr === 0 && first.dc === 0
        ? { key: 'networks.s.oscillator', vars: { p: first.period } }
        : { key: 'networks.s.spaceship', vars: { p: first.period, dr: first.dr, dc: first.dc } },
    );
  } else steps.push({ key: 'networks.s.noPeriod' });
  if (pattern === 'random') rows.push({ label: 'networks.r.seed', value: seed });
  return {
    rows,
    steps,
    notes: [{ key: 'networks.n.life' }],
    plots: [
      {
        title: 'networks.p.lifeGrid',
        vars: { g: generations },
        x: { label: 'networks.p.column' },
        y: { label: 'networks.p.row' },
        series: [{ name: 'networks.p.alive', style: 'points', points: cells(grid, n, 1) }],
      },
      {
        title: 'networks.p.population',
        x: { label: 'networks.p.generation' },
        y: { label: 'networks.p.cellsAlive', min: 0 },
        series: [{ name: 'networks.p.alive', points: population }],
      },
    ],
  };
}

// ---- Elementary cellular automata ---------------------------------------------------------------------------------

export function elementary(rule: number, width: number, steps: number, start: 'single' | 'random', seed: number) {
  const rng = createRng(seed);
  let row: number[] = Array.from({ length: width }, (_, i) =>
    start === 'single' ? (i === Math.floor(width / 2) ? 1 : 0) : rng.next() < 0.5 ? 1 : 0,
  );
  const rows = [row];
  for (let t = 0; t < steps; t += 1) {
    const prev = row;
    row = prev.map(
      (_, i) => (rule >> ((prev[wrap(i - 1, width)] << 2) | (prev[i] << 1) | prev[wrap(i + 1, width)])) & 1,
    );
    rows.push(row);
  }
  return rows;
}

export function elementaryResult(
  rule: number,
  width: number,
  steps: number,
  start: 'single' | 'random',
  seed: number,
): CalcResult {
  whole(rule, 'rule', 0);
  within(rule, 'rule', 0, 255);
  whole(width, 'width', 3);
  within(width, 'width', 3, 400);
  whole(steps, 'steps', 1);
  within(steps, 'steps', 1, 400);
  const rows = elementary(rule, width, steps, start, seed);
  const points: Point[] = [];
  rows.forEach((r, t) => r.forEach((v, i) => v && points.push([i, -t])));
  const table = Array.from({ length: 8 }, (_, k) => 7 - k).map((k) => [
    k.toString(2).padStart(3, '0'),
    (rule >> k) & 1,
  ]);
  const density = rows[rows.length - 1].reduce((s, v) => s + v, 0) / width;
  return {
    rows: [
      { label: 'networks.r.ruleBits', value: rule.toString(2).padStart(8, '0') },
      { label: 'networks.r.density', value: 100 * density, unit: '%' },
      ...(start === 'random' ? [{ label: 'networks.r.seed' as const, value: seed }] : []),
    ],
    steps: [{ key: 'networks.s.eca', vars: { r: rule, b: rule.toString(2).padStart(8, '0') } }],
    table: { header: [{ key: 'networks.t.neighborhood' }, { key: 'networks.t.next' }], rows: table },
    notes: [{ key: 'networks.n.eca' }],
    plots: [
      {
        title: 'networks.p.eca',
        vars: { r: rule },
        x: { label: 'networks.p.cell' },
        y: { label: 'networks.p.timeDown', absolute: true },
        series: [{ name: 'networks.p.on', style: 'points', points }],
      },
    ],
  };
}

// ---- Granovetter threshold model -------------------------------------------------------------------------------

/** Adoption in a whole population: each round, everyone whose threshold is at most the share adopting joins. */
export function granovetter(thresholds: readonly number[], rounds = 500): Point[] {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const n = sorted.length;
  let share = 0;
  const path: Point[] = [[0, 0]];
  for (let t = 1; t <= rounds; t += 1) {
    let count = 0;
    while (count < n && sorted[count] <= share + 1e-12) count += 1;
    const next = count / n;
    path.push([t, next]);
    if (next === share) break;
    share = next;
  }
  return path;
}

export function thresholdModelResult(
  n: number,
  shape: 'uniform' | 'normal',
  mean: number,
  sd: number,
  seed: number,
): CalcResult {
  whole(n, 'N', 10);
  within(n, 'N', 10, 100000);
  const rng = createRng(seed);
  let thresholds: number[];
  if (shape === 'uniform') thresholds = Array.from({ length: n }, (_, i) => i / n);
  else {
    within(mean, 'mean', 0, 1);
    within(sd, 'sd', 0, 1);
    thresholds = Array.from({ length: n }, () => Math.min(Math.max(mean + sd * rng.normal(), 0), 1));
  }
  const path = granovetter(thresholds);
  const end = path[path.length - 1][1];
  const series: Series[] = [{ name: 'networks.p.adoption', points: path }];
  return {
    rows: [
      { label: 'networks.r.adopted', value: 100 * end, unit: '%' },
      { label: 'networks.r.rounds', value: path.length - 2 },
      ...(shape === 'normal' ? [{ label: 'networks.r.seed' as const, value: seed }] : []),
    ],
    steps: [
      { key: `networks.s.thresholds.${shape}`, vars: { n, m: mean, s: sd } },
      { key: end >= 0.99 ? 'networks.s.cascade' : 'networks.s.stall', vars: { f: 100 * end, k: path.length - 2 } },
    ],
    notes: [{ key: 'networks.n.granovetter' }],
    plots: [
      {
        title: 'networks.p.granovetter',
        x: { label: 'networks.p.round' },
        y: { label: 'networks.p.share', min: 0, max: 1 },
        series,
      },
    ],
  };
}
