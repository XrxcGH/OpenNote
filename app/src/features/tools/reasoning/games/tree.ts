// Extensive-form games with perfect information, typed as an indented tree. Backward induction picks the best move
// at every decision node, in and out of equilibrium play, which is the subgame-perfect equilibrium. Chance nodes
// average their branches.
//
//   P1
//     L: P2
//       l: 3, 1
//       r: 0, 0
//     R: 2, 2
//
// A branch to a chance node gives each of its branches a probability: "up [1/2]: 4, 0".
import { ZERO, add, cmp, fracText, mul, parseFrac } from '../core/frac';
import type { Frac } from '../core/frac';
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail } from '../core/util';

export interface GameNode {
  /** The move into this node from its parent; empty at the root. */
  move: string;
  prob: Frac | null;
  player: string | null;
  payoff: Frac[] | null;
  children: GameNode[];
}

const CHANCE = new Set(['chance', 'nature', 'n']);
export const isChance = (player: string | null): boolean => player !== null && CHANCE.has(player.toLowerCase());

function parseContent(content: string, line: number): Pick<GameNode, 'player' | 'payoff'> {
  if (/^[A-Za-z][\w ]*$/.test(content)) return { player: content.trim(), payoff: null };
  const parts = content
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseFrac);
  if (parts.length === 0 || parts.some((p) => p === null)) fail('treeContent', { line });
  return { player: null, payoff: parts as Frac[] };
}

/**
 * Reads the tree. With `oneDecider`, a node typed as the word "decision" belongs to the root's decision maker, so a
 * single-maker decision tree can write nested decisions as "name: decision".
 */
export function parseTree(text: string, oneDecider = false): { root: GameNode; players: string[] } {
  const raw = text
    .split(/\r?\n/)
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => l.trim() && !l.trim().startsWith('#'));
  if (raw.length === 0) fail('treeEmpty');
  const stack: { depth: number; node: GameNode }[] = [];
  let root: GameNode | null = null;
  for (const { l, i } of raw) {
    const depth = l.length - l.trimStart().length;
    const body = l.trim();
    if (!root) {
      if (body.includes(':')) fail('treeRoot');
      root = { move: '', prob: null, ...parseContent(body, i), children: [] };
      stack.push({ depth, node: root });
      continue;
    }
    const m = /^([^:[\]]+?)\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/.exec(body);
    if (!m) return fail('treeLine', { line: i });
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (!parent) return fail('treeIndent', { line: i });
    if (parent.payoff) fail('treeLeafChild', { line: i });
    const prob = m[2] !== undefined ? parseFrac(m[2]) : null;
    if (m[2] !== undefined && prob === null) fail('treeProb', { line: i });
    const node: GameNode = { move: m[1].trim(), prob, ...parseContent(m[3], i), children: [] };
    parent.children.push(node);
    stack.push({ depth, node });
  }
  if (oneDecider) {
    const maker = root!.player && !isChance(root!.player) ? root!.player : 'decision';
    const rename = (n: GameNode) => {
      if (n.player && n.player.toLowerCase() === 'decision') n.player = maker;
      n.children.forEach(rename);
    };
    rename(root!);
  }
  const players: string[] = [];
  const visit = (n: GameNode) => {
    if (n.player && !isChance(n.player) && !players.includes(n.player)) players.push(n.player);
    n.children.forEach(visit);
  };
  visit(root!);
  checkTree(root!, players.length);
  return { root: root!, players };
}

function checkTree(n: GameNode, count: number): void {
  if (n.payoff) {
    if (n.payoff.length !== count) fail('treePayoffs', { move: n.move || '–', count });
    return;
  }
  if (n.children.length === 0) fail('treeNoMoves', { player: n.player ?? '' });
  if (isChance(n.player)) {
    const total = n.children.reduce((s, c) => (c.prob ? add(s, c.prob) : s), ZERO);
    if (n.children.some((c) => c.prob === null) || cmp(total, { n: 1n, d: 1n }) !== 0) fail('treeChance');
  }
  n.children.forEach((c) => checkTree(c, count));
}

export interface Solved {
  value: Frac[];
  /** The move chosen at each decision node, by node. */
  choice: Map<GameNode, number>;
  ties: GameNode[];
  steps: Step[];
}

/** Backward induction from the leaves up. */
export function solveTree(root: GameNode, players: readonly string[]): Solved {
  const choice = new Map<GameNode, number>();
  const ties: GameNode[] = [];
  const steps: Step[] = [];
  const show = (v: Frac[]) => `(${v.map(fracText).join(', ')})`;
  const value = (n: GameNode, path: string): Frac[] => {
    if (n.payoff) return n.payoff;
    const values = n.children.map((c) => value(c, path ? `${path}, ${c.move}` : c.move));
    if (isChance(n.player)) {
      const mean = players.map((_, k) => values.reduce((s, v, i) => add(s, mul(n.children[i].prob!, v[k])), ZERO));
      steps.push(path ? step('chance', { at: path, value: show(mean) }) : step('chanceRoot', { value: show(mean) }));
      return mean;
    }
    const k = players.indexOf(n.player!);
    let best = 0;
    values.forEach((v, i) => {
      if (cmp(v[k], values[best][k]) > 0) best = i;
    });
    if (values.some((v, i) => i !== best && cmp(v[k], values[best][k]) === 0)) ties.push(n);
    choice.set(n, best);
    const picked = { player: n.player!, move: n.children[best].move, value: show(values[best]) };
    steps.push(path ? step('choose', { ...picked, at: path }) : step('chooseRoot', picked));
    return values[best];
  };
  return { value: value(root, ''), choice, ties, steps };
}

/** The moves of equilibrium play from the root; a chance node ends the single path. */
export function playPath(root: GameNode, choice: Map<GameNode, number>): string[] {
  const path: string[] = [];
  for (let n = root; !n.payoff && choice.has(n);) {
    const next = n.children[choice.get(n)!];
    path.push(`${n.player}: ${next.move}`);
    n = next;
  }
  return path;
}
