// A grid world for reinforcement learning. Each cell is open (.), a wall (#), the start (S), or a terminal cell
// with a reward (G for the goal, X for a pit, or a number). Every move has a slip chance: with it, the agent goes
// to one side instead. A state's value follows the reward-of-a-state convention: V(s) = R(s) + gamma max_a sum
// p V(s'), with a terminal cell worth its reward. Value iteration, policy iteration, Q-learning, and SARSA all
// work on the same model.
import type { Rng } from '../kit/rng';
import { fail } from '../kit/types';

export const MOVES = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
] as const;
/** Up, right, down, left. */
export const ARROWS = ['↑', '→', '↓', '←'] as const;

export interface Grid {
  readonly rows: number;
  readonly cols: number;
  /** Row-major: true for a wall. */
  readonly wall: readonly boolean[];
  /** The reward of a terminal cell; NaN elsewhere. */
  readonly terminal: readonly number[];
  readonly start: number;
  /** The reward of every move from an open cell. */
  readonly stepReward: number;
  readonly slip: number;
}

export function readGrid(text: string, goal: number, pit: number, stepReward: number, slip: number): Grid {
  const lines = text
    .split(/\r?\n/)
    .map((one) => one.trim())
    .filter((one) => one !== '' && !one.startsWith('//'));
  if (lines.length === 0) fail('empty', {}, 'grid');
  const cells = lines.map((one) => (one.includes(' ') ? one.split(/\s+/) : one.split('')));
  const cols = cells[0].length;
  if (cells.some((row) => row.length !== cols)) fail('gridRagged', {}, 'grid');
  if (!(slip >= 0 && slip <= 1)) fail('range', { low: 0, high: 1 }, 'slip');
  const wall: boolean[] = [];
  const terminal: number[] = [];
  let start = -1;
  cells.flat().forEach((c, i) => {
    const up = c.toUpperCase();
    wall.push(up === '#');
    const n = Number(c);
    terminal.push(
      up === 'G' ? goal : up === 'X' ? pit : c !== '.' && c !== '#' && up !== 'S' && Number.isFinite(n) ? n : NaN,
    );
    if (up === 'S') start = i;
    if (!['.', '#', 'G', 'X', 'S'].includes(up) && !Number.isFinite(n)) fail('gridCell', { cell: c }, 'grid');
  });
  if (start < 0) start = wall.findIndex((w, i) => !w && Number.isNaN(terminal[i]));
  if (start < 0) fail('gridStart', {}, 'grid');
  if (!terminal.some((t) => !Number.isNaN(t))) fail('gridGoal', {}, 'grid');
  return { rows: cells.length, cols, wall, terminal, start, stepReward, slip };
}

export const isTerminal = (g: Grid, s: number): boolean => !Number.isNaN(g.terminal[s]);

/** Where a move leads: a wall or the edge leaves the agent where it is. */
export function moveTo(g: Grid, s: number, a: number): number {
  const r = Math.floor(s / g.cols) + MOVES[a][0];
  const c = (s % g.cols) + MOVES[a][1];
  if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return s;
  const next = r * g.cols + c;
  return g.wall[next] ? s : next;
}

/** The outcomes of action a: the intended move with 1 - slip, each side with slip / 2. */
export function outcomes(g: Grid, s: number, a: number): { next: number; p: number }[] {
  const out = [{ next: moveTo(g, s, a), p: 1 - g.slip }];
  if (g.slip > 0)
    out.push({ next: moveTo(g, s, (a + 1) % 4), p: g.slip / 2 }, { next: moveTo(g, s, (a + 3) % 4), p: g.slip / 2 });
  return out;
}

/** The value of a state, for the backup: a terminal cell is worth its reward. */
const worth = (g: Grid, V: readonly number[], s: number) => (isTerminal(g, s) ? g.terminal[s] : V[s]);

export const qValue = (g: Grid, V: readonly number[], s: number, a: number, gamma: number): number =>
  g.stepReward + gamma * outcomes(g, s, a).reduce((sum, o) => sum + o.p * worth(g, V, o.next), 0);

export interface Solved {
  readonly V: readonly number[];
  /** The best action in each open cell; -1 for walls and terminal cells. */
  readonly policy: readonly number[];
  readonly sweeps: number;
}

const open = (g: Grid) => g.wall.map((w, s) => !w && !isTerminal(g, s));

function greedy(g: Grid, V: readonly number[], gamma: number): number[] {
  const live = open(g);
  return V.map((_, s) => {
    if (!live[s]) return -1;
    let best = 0;
    for (let a = 1; a < 4; a += 1) if (qValue(g, V, s, a, gamma) > qValue(g, V, s, best, gamma) + 1e-12) best = a;
    return best;
  });
}

export function valueIteration(g: Grid, gamma: number, tol = 1e-10, maxSweeps = 10000): Solved {
  // gamma = 1 is allowed: readGrid requires a terminal cell, so episodes end; the sweep cap guards the rest.
  if (!(gamma >= 0 && gamma <= 1)) fail('range', { low: 0, high: 1 }, 'gamma');
  const live = open(g);
  const V = g.terminal.map((t) => (Number.isNaN(t) ? 0 : t));
  let sweeps = 0;
  for (; sweeps < maxSweeps; sweeps += 1) {
    let change = 0;
    for (let s = 0; s < V.length; s += 1) {
      if (!live[s]) continue;
      const best = Math.max(...[0, 1, 2, 3].map((a) => qValue(g, V, s, a, gamma)));
      change = Math.max(change, Math.abs(best - V[s]));
      V[s] = best;
    }
    if (change < tol) break;
  }
  return { V, policy: greedy(g, V, gamma), sweeps: sweeps + 1 };
}

/** Policy iteration: evaluate the policy (iteratively, to tol), then improve it greedily, until it is stable. */
export function policyIteration(g: Grid, gamma: number, tol = 1e-10): Solved {
  // gamma = 1 is allowed: readGrid requires a terminal cell, so episodes end; the sweep cap guards the rest.
  if (!(gamma >= 0 && gamma <= 1)) fail('range', { low: 0, high: 1 }, 'gamma');
  const live = open(g);
  const V = g.terminal.map((t) => (Number.isNaN(t) ? 0 : t));
  let policy: number[] = V.map((_, s) => (live[s] ? 0 : -1));
  let rounds = 0;
  for (; rounds < 1000; rounds += 1) {
    for (let k = 0; k < 10000; k += 1) {
      let change = 0;
      for (let s = 0; s < V.length; s += 1) {
        if (!live[s]) continue;
        const next = qValue(g, V, s, policy[s], gamma);
        change = Math.max(change, Math.abs(next - V[s]));
        V[s] = next;
      }
      if (change < tol) break;
    }
    const improved = policy.map((a, s) => {
      if (!live[s]) return -1;
      const best = greedy(g, V, gamma)[s];
      return qValue(g, V, s, best, gamma) > qValue(g, V, s, a, gamma) + 1e-9 ? best : a;
    });
    const stable = improved.every((a, s) => a === policy[s]);
    policy = improved;
    if (stable) break;
  }
  return { V, policy, sweeps: rounds + 1 };
}

/** One Q-learning update: Q + alpha (r + gamma max Q' - Q). */
export const qUpdate = (q: number, alpha: number, r: number, gamma: number, maxNext: number): number =>
  q + alpha * (r + gamma * maxNext - q);

export interface Learned {
  /** Q[s][a]. */
  readonly Q: readonly (readonly number[])[];
  readonly policy: readonly number[];
  /** The return of each episode. */
  readonly returns: readonly number[];
}

/**
 * Q-learning (off-policy) or SARSA (on-policy) with epsilon-greedy choices, for `episodes` episodes of at most
 * `maxSteps` moves from the start. Each move earns the step reward, and a terminal cell is worth its reward, as
 * in the value iteration, so the learned Q values approach the same answer. Ties go to the first action.
 */
export function learnGrid(
  g: Grid,
  method: 'q' | 'sarsa',
  alpha: number,
  gamma: number,
  epsilon: number,
  episodes: number,
  rng: Rng,
  maxSteps = 500,
): Learned {
  const Q = g.wall.map(() => [0, 0, 0, 0]);
  const choose = (s: number) => {
    if (rng.next() < epsilon) return rng.int(4);
    let best = 0;
    for (let a = 1; a < 4; a += 1) if (Q[s][a] > Q[s][best]) best = a;
    return best;
  };
  const step = (s: number, a: number) => {
    const u = rng.next();
    let acc = 0;
    for (const o of outcomes(g, s, a)) {
      acc += o.p;
      if (u < acc) return o.next;
    }
    return moveTo(g, s, a);
  };
  const returns: number[] = [];
  for (let e = 0; e < episodes; e += 1) {
    let s = g.start;
    let a = choose(s);
    let total = 0;
    let discount = 1;
    for (let k = 0; k < maxSteps; k += 1) {
      const next = step(s, a);
      const done = isTerminal(g, next);
      const nextA = done ? 0 : choose(next);
      // A terminal cell is worth its reward, one step on, as in the value iteration.
      const future = done ? g.terminal[next] : method === 'q' ? Math.max(...Q[next]) : Q[next][nextA];
      total += discount * (g.stepReward + (done ? gamma * g.terminal[next] : 0));
      discount *= gamma;
      Q[s][a] = qUpdate(Q[s][a], alpha, g.stepReward, gamma, future);
      if (done) break;
      s = next;
      a = nextA;
    }
    returns.push(total);
  }
  const live = open(g);
  const policy = Q.map((q, s) => (live[s] ? q.indexOf(Math.max(...q)) : -1));
  return { Q, policy, returns };
}
