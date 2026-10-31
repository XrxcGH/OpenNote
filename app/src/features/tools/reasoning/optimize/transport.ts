// Transportation problems: balance with a dummy source or destination, start by the northwest corner or Vogel's
// approximation, then improve by MODI (the u-v method) around stepping-stone loops until no reduced cost is negative.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, num } from '../core/util';

export type Start = 'northwest' | 'vogel';

export interface Plan {
  /** Shipments; a basic cell may ship 0 when the plan is degenerate. */
  ship: number[][];
  basic: boolean[][];
  total: number;
}

export interface ModiRound {
  u: number[];
  v: number[];
  /** c_ij - u_i - v_j for each cell outside the basis; null for basic cells. */
  reduced: (number | null)[][];
  entering?: [number, number];
  theta?: number;
}

export interface TransportResult {
  cost: number[][];
  supply: number[];
  demand: number[];
  /** A dummy row or column added to balance supply and demand, with zero cost. */
  dummy: 'source' | 'destination' | null;
  initial: Plan;
  rounds: ModiRound[];
  plan: Plan;
  steps: Step[];
}

const EPS = 1e-9;
const copy = <T>(m: T[][]): T[][] => m.map((r) => [...r]);
const totalOf = (cost: number[][], ship: number[][]) =>
  ship.reduce((s, r, i) => s + r.reduce((t, q, j) => t + q * cost[i][j], 0), 0);
const empty = <T>(m: number, n: number, v: T): T[][] => Array.from({ length: m }, () => Array<T>(n).fill(v));

function northwest(supply: number[], demand: number[]): { ship: number[][]; basic: boolean[][] } {
  const m = supply.length;
  const n = demand.length;
  const s = [...supply];
  const d = [...demand];
  const ship = empty(m, n, 0);
  const basic = empty(m, n, false);
  let i = 0;
  let j = 0;
  for (;;) {
    const q = Math.min(s[i], d[j]);
    ship[i][j] = q;
    basic[i][j] = true;
    s[i] -= q;
    d[j] -= q;
    if (i === m - 1 && j === n - 1) break;
    if ((s[i] <= EPS && i < m - 1) || j === n - 1) i += 1;
    else j += 1;
  }
  return { ship, basic };
}

const penalty = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length > 1 ? sorted[1] - sorted[0] : (sorted[0] ?? 0);
};

function vogel(cost: number[][], supply: number[], demand: number[]): { ship: number[][]; basic: boolean[][] } {
  const m = supply.length;
  const n = demand.length;
  const s = [...supply];
  const d = [...demand];
  const ship = empty(m, n, 0);
  const basic = empty(m, n, false);
  const rowOn = supply.map(() => true);
  const colOn = demand.map(() => true);
  const give = (i: number, j: number) => {
    const q = Math.min(s[i], d[j]);
    ship[i][j] = q;
    basic[i][j] = true;
    s[i] -= q;
    d[j] -= q;
  };
  for (let guard = 0; guard < m + n; guard += 1) {
    const rows = rowOn.flatMap((on, i) => (on ? [i] : []));
    const cols = colOn.flatMap((on, j) => (on ? [j] : []));
    if (rows.length === 0 || cols.length === 0) break;
    if (rows.length === 1 || cols.length === 1) {
      for (const i of rows) for (const j of cols) give(i, j);
      break;
    }
    let line = { row: true, k: rows[0], p: -Infinity };
    for (const i of rows) {
      const p = penalty(cols.map((j) => cost[i][j]));
      if (p > line.p + EPS) line = { row: true, k: i, p };
    }
    for (const j of cols) {
      const p = penalty(rows.map((i) => cost[i][j]));
      if (p > line.p + EPS) line = { row: false, k: j, p };
    }
    let i = line.k;
    let j = line.k;
    if (line.row) j = cols.reduce((a, b) => (cost[i][b] < cost[i][a] ? b : a));
    else i = rows.reduce((a, b) => (cost[b][j] < cost[a][j] ? b : a));
    give(i, j);
    if (s[i] <= EPS) rowOn[i] = false;
    else colOn[j] = false;
  }
  return { ship, basic };
}

/** Adds zero shipments on the cheapest cells that join separate parts until the basis has m + n - 1 cells. */
function completeBasis(cost: number[][], basic: boolean[][]): void {
  const m = cost.length;
  const n = cost[0].length;
  const parent = Array.from({ length: m + n }, (_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  let count = 0;
  for (let i = 0; i < m; i += 1)
    for (let j = 0; j < n; j += 1)
      if (basic[i][j]) {
        parent[find(i)] = find(m + j);
        count += 1;
      }
  const cells = cost.flatMap((r, i) => r.map((c, j) => ({ i, j, c }))).sort((a, b) => a.c - b.c);
  for (const { i, j } of cells) {
    if (count >= m + n - 1) break;
    if (basic[i][j] || find(i) === find(m + j)) continue;
    basic[i][j] = true;
    parent[find(i)] = find(m + j);
    count += 1;
  }
}

/** The basic cells on the path from column `to` to row `from`, in order. */
function treePath(basic: boolean[][], from: number, to: number): [number, number][] | null {
  const m = basic.length;
  // Nodes 0..m-1 are rows and m.. are columns.
  const prev = new Map<number, number>([[m + to, -1]]);
  const queue = [m + to];
  while (queue.length) {
    const k = queue.shift()!;
    if (k === from) break;
    const next =
      k < m ? basic[k].flatMap((b, j) => (b ? [m + j] : [])) : basic.flatMap((r, i) => (r[k - m] ? [i] : []));
    for (const x of next)
      if (!prev.has(x)) {
        prev.set(x, k);
        queue.push(x);
      }
  }
  if (!prev.has(from)) return null;
  const nodes: number[] = [];
  for (let k = from; k !== -1; k = prev.get(k)!) nodes.push(k);
  nodes.reverse();
  const cells: [number, number][] = [];
  for (let a = 0; a + 1 < nodes.length; a += 1) {
    const [x, y] = [nodes[a], nodes[a + 1]];
    cells.push(x < m ? [x, y - m] : [y, x - m]);
  }
  return cells;
}

function potentials(cost: number[][], basic: boolean[][]): { u: number[]; v: number[] } {
  const m = cost.length;
  const n = cost[0].length;
  const u: (number | null)[] = Array(m).fill(null);
  const v: (number | null)[] = Array(n).fill(null);
  u[0] = 0;
  for (let pass = 0; pass < m + n; pass += 1)
    for (let i = 0; i < m; i += 1)
      for (let j = 0; j < n; j += 1) {
        if (!basic[i][j]) continue;
        if (u[i] !== null && v[j] === null) v[j] = cost[i][j] - u[i]!;
        else if (v[j] !== null && u[i] === null) u[i] = cost[i][j] - v[j]!;
      }
  return { u: u.map((x) => x ?? 0), v: v.map((x) => x ?? 0) };
}

export function transport(costIn: number[][], supplyIn: number[], demandIn: number[], start: Start): TransportResult {
  if (costIn.length === 0 || costIn[0].length === 0) fail('trEmpty');
  if (supplyIn.length !== costIn.length) fail('trSupply', { rows: costIn.length, count: supplyIn.length });
  if (demandIn.length !== costIn[0].length) fail('trDemand', { cols: costIn[0].length, count: demandIn.length });
  if ([...supplyIn, ...demandIn].some((x) => x < 0)) fail('trNegative');
  if ((costIn.length + 1) * (costIn[0].length + 1) > 169) fail('trTooBig', { size: 12 });
  const cost = copy(costIn);
  const supply = [...supplyIn];
  const demand = [...demandIn];
  const steps: Step[] = [];
  const S = supply.reduce((a, b) => a + b, 0);
  const D = demand.reduce((a, b) => a + b, 0);
  if (S <= EPS || D <= EPS) fail('trNoSupply');
  let dummy: TransportResult['dummy'] = null;
  if (S > D + EPS) {
    dummy = 'destination';
    cost.forEach((r) => r.push(0));
    demand.push(S - D);
    steps.push(step('trDummyCol', { amount: num(S - D) }));
  } else if (D > S + EPS) {
    dummy = 'source';
    cost.push(demand.map(() => 0));
    supply.push(D - S);
    steps.push(step('trDummyRow', { amount: num(D - S) }));
  } else steps.push(step('trBalanced', { total: num(S) }));
  const first = start === 'vogel' ? vogel(cost, supply, demand) : northwest(supply, demand);
  completeBasis(cost, first.basic);
  const initial: Plan = { ship: copy(first.ship), basic: copy(first.basic), total: totalOf(cost, first.ship) };
  steps.push(step(start === 'vogel' ? 'trVogel' : 'trNorthwest', { total: num(initial.total) }));
  const ship = copy(first.ship);
  const basic = copy(first.basic);
  const rounds: ModiRound[] = [];
  for (let iter = 0; iter < 60; iter += 1) {
    const { u, v } = potentials(cost, basic);
    const reduced = cost.map((r, i) => r.map((c, j) => (basic[i][j] ? null : c - u[i] - v[j])));
    let entering: [number, number] | undefined;
    let least = -EPS;
    reduced.forEach((r, i) =>
      r.forEach((d, j) => {
        if (d !== null && d < least) {
          least = d;
          entering = [i, j];
        }
      }),
    );
    const round: ModiRound = { u, v, reduced };
    rounds.push(round);
    if (!entering) {
      steps.push(step('trOptimal', { total: num(totalOf(cost, ship)) }));
      break;
    }
    const [ei, ej] = entering;
    const path = treePath(basic, ei, ej);
    if (!path) break;
    const loop: [number, number][] = [entering, ...path];
    const minus = loop.filter((_, k) => k % 2 === 1);
    const theta = Math.min(...minus.map(([i, j]) => ship[i][j]));
    const leaving = minus.find(([i, j]) => Math.abs(ship[i][j] - theta) <= EPS)!;
    loop.forEach(([i, j], k) => {
      ship[i][j] += k % 2 === 0 ? theta : -theta;
      if (Math.abs(ship[i][j]) <= EPS) ship[i][j] = 0;
    });
    basic[ei][ej] = true;
    basic[leaving[0]][leaving[1]] = false;
    round.entering = entering;
    round.theta = theta;
    steps.push(
      step('trPivot', {
        cell: `(${ei + 1}, ${ej + 1})`,
        reduced: num(least),
        theta: num(theta),
        leaving: `(${leaving[0] + 1}, ${leaving[1] + 1})`,
        total: num(totalOf(cost, ship)),
      }),
    );
  }
  return { cost, supply, demand, dummy, initial, rounds, plan: { ship, basic, total: totalOf(cost, ship) }, steps };
}
