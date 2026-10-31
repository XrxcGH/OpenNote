// The games tool's game-theory modes as forms: normal-form games, game trees, and closed forms for repeated games,
// bargaining, and auctions. Voting, apportionment, power, and districting are in formsVoting.ts.
import { fracText, isZero } from '../core/frac';
import type { Frac } from '../core/frac';
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, num, numbers } from '../core/util';
import { attempt, say, saySteps } from '../ui/say';
import type { Mode, Outcome, ToolSpec, Values } from '../ui/types';
import { auction, grimThreshold, nashBargaining, rubinstein } from './formulas';
import { APPORTION, COMPACT, DISTRICTS, POWER, STV, VOTING } from './formsVoting';
import {
  bestResponses,
  dominantStrategies,
  eliminate,
  mixedEquilibria,
  parseGame,
  pureEquilibria,
  zeroSumValue,
} from './normal';
import type { Bimatrix } from './normal';
import { parseThree, pureEquilibria3, strictlyDominated3 } from './three';
import { isChance, parseTree, playPath, solveTree } from './tree';
import type { GameNode } from './tree';

const T = 'games';
const s = (path: string, vars?: Record<string, string | number>) => say(`${T}.${path}`, vars);
const mix = (p: readonly Frac[], names: readonly string[]) =>
  p
    .map((x, i) => (isZero(x) ? '' : x.n === x.d ? names[i] : `${names[i]} ${fracText(x)}`))
    .filter(Boolean)
    .join(', ');

function payoffTable(g: Bimatrix) {
  const { rowBest, colBest } = bestResponses(g);
  return {
    caption: s('table.payoffs'),
    header: ['', ...g.cols],
    rows: g.A.map((row, i) => [
      g.rows[i],
      ...row.map(
        (a, j) => `${fracText(a)}${rowBest[i][j] ? '*' : ''}, ${fracText(g.B[i][j])}${colBest[i][j] ? '*' : ''}`,
      ),
    ]),
  };
}

function eliminationSteps(g: Bimatrix): string[] {
  const out: string[] = [];
  const strict = eliminate(g, false);
  const weak = eliminate(g, true);
  const same = JSON.stringify(strict.order) === JSON.stringify(weak.order);
  for (const [r, isWeak] of same
    ? ([[strict, false]] as const)
    : ([
        [strict, false],
        [weak, true],
      ] as const)) {
    for (const e of r.order) {
      const names = e.player === 'row' ? g.rows : g.cols;
      const vars = { player: s(e.player), removed: names[e.removed], by: names[e.by] };
      out.push(s(isWeak ? 'steps.weak' : 'steps.strict', vars));
    }
    out.push(
      s('steps.left', {
        kind: s(isWeak ? 'weakly' : 'strictly'),
        rows: r.rows.map((i) => g.rows[i]).join(', '),
        cols: r.cols.map((j) => g.cols[j]).join(', '),
      }),
    );
  }
  return out;
}

function normalOutcome(v: Values): Outcome {
  const g = parseGame(v.payoffs ?? '', v.rows ?? '', v.cols ?? '');
  const pure = pureEquilibria(g);
  const mixed = mixedEquilibria(g);
  const dom = dominantStrategies(g);
  const notes: string[] = [];
  if (dom.rows.length) notes.push(s('dominantRow', { name: g.rows[dom.rows[0]] }));
  if (dom.cols.length) notes.push(s('dominantCol', { name: g.cols[dom.cols[0]] }));
  const steps = eliminationSteps(g);
  let answer =
    pure.length > 0
      ? s('pureAnswer', { list: pure.map(([i, j]) => `(${g.rows[i]}, ${g.cols[j]})`).join(', ') })
      : s('noPure');
  if (g.zeroSum) {
    const z = zeroSumValue(g.A);
    answer = s('zeroSumAnswer', { value: fracText(z.value), row: mix(z.x, g.rows), col: mix(z.y, g.cols) });
    steps.push(...saySteps(T, z.steps));
  }
  if (mixed.length > pure.length) notes.push(s('mixedCount', { count: mixed.length }));
  return {
    ok: true,
    answer,
    note: notes.join('\n') || undefined,
    steps,
    tables: [
      payoffTable(g),
      {
        caption: s('table.equilibria'),
        header: [s('table.rowMix'), s('table.colMix'), s('table.rowPays'), s('table.colPays')],
        rows: mixed.map((e) => [mix(e.x, g.rows), mix(e.y, g.cols), fracText(e.u), fracText(e.v)]),
      },
    ],
  };
}

function toTree(n: GameNode, choice: Map<GameNode, number>, onPath: boolean, players: readonly string[]): TreeNode {
  const chosen = choice.get(n);
  return {
    label: n.payoff ? `(${n.payoff.map(fracText).join(', ')})` : (n.player ?? ''),
    edge: n.move ? `${n.move}${n.prob ? ` [${fracText(n.prob)}]` : ''}` : undefined,
    shape: n.payoff ? 'box' : isChance(n.player) ? 'circle' : 'square',
    tone: onPath ? 'accent' : undefined,
    children: n.children
      .map((c, i) => toTree(c, choice, onPath && (isChance(n.player) || chosen === i), players))
      .map((c, i) => (isChance(n.player) || chosen === i ? c : { ...c, cut: true })),
  };
}

function treeOutcome(v: Values): Outcome {
  const { root, players } = parseTree(v.tree ?? '');
  const solved = solveTree(root, players);
  const path = playPath(root, solved.choice);
  const tree = toTree(root, solved.choice, true, players);
  return {
    ok: true,
    answer: s('treeAnswer', { path: path.join('; ') || '–', payoffs: `(${solved.value.map(fracText).join(', ')})` }),
    note: solved.ties.length ? s('ties', { count: solved.ties.length }) : undefined,
    steps: saySteps(T, solved.steps),
    figure: { svg: treeFigure(tree), alt: s('treeAlt', { tree: treeText(tree) }) },
  };
}

function formulaOutcome(v: Values): Outcome {
  const x = (id: string) => {
    const n = numbers(v[id] ?? '');
    if (!n || n.length !== 1) fail('number', { field: s(`fields.${id}`) });
    return n![0];
  };
  if (v.kind === 'grim') {
    const d = grimThreshold(x('temptation'), x('reward'), x('punishment'));
    return {
      ok: true,
      answer: s('grimAnswer', { delta: num(d, 6) }),
      latex: `\\delta \\ge \\frac{T - R}{T - P} = ${num(d, 6)}`,
      steps: [s('steps.grim')],
    };
  }
  if (v.kind === 'bargain') {
    const [a, b] = nashBargaining(x('surplus'), x('d1'), x('d2'), x('weight'));
    return { ok: true, answer: s('bargainAnswer', { a: num(a), b: num(b) }), steps: [s('steps.bargain')] };
  }
  if (v.kind === 'rubinstein') {
    const [a, b] = rubinstein(x('delta1'), x('delta2'));
    return {
      ok: true,
      answer: s('rubinsteinAnswer', { a: num(a, 6), b: num(b, 6) }),
      latex: `x_1 = \\frac{1 - \\delta_2}{1 - \\delta_1 \\delta_2} = ${num(a, 6)}`,
      steps: [s('steps.rubinstein')],
    };
  }
  const r = auction(x('bidders'), x('top'), x('rounds'), x('seed'));
  return {
    ok: true,
    answer: s('auctionAnswer', { share: num(r.bidShare, 6), revenue: num(r.revenue, 6) }),
    note: s('auctionSim', { first: num(r.simFirst, 4), second: num(r.simSecond, 4) }),
    steps: [s('steps.auctionBid'), s('steps.auctionRevenue')],
  };
}

const FORMULA_FIELDS: Record<string, readonly [string, string][]> = {
  grim: [
    ['temptation', '5'],
    ['reward', '3'],
    ['punishment', '1'],
  ],
  bargain: [
    ['surplus', '10'],
    ['d1', '2'],
    ['d2', '0'],
    ['weight', '0.5'],
  ],
  rubinstein: [
    ['delta1', '0.9'],
    ['delta2', '0.9'],
  ],
  auction: [
    ['bidders', '3'],
    ['top', '1'],
    ['rounds', '10000'],
    ['seed', '1'],
  ],
};

const solveWith = (fn: (v: Values) => Outcome) => (v: Values) => attempt(T, () => fn(v));

const NORMAL: Mode = {
  id: 'normal',
  fields: [
    { id: 'payoffs', kind: 'area', initial: '3,3 0,5\n5,0 1,1', help: true },
    { id: 'rows', initial: 'C D' },
    { id: 'cols', initial: 'C D' },
  ],
  solve: solveWith(normalOutcome),
};

function threeOutcome(v: Values): Outcome {
  const g = parseThree(v.payoffs3 ?? '', [v.rows ?? '', v.cols ?? '', v.layers ?? '']);
  const pure = pureEquilibria3(g);
  const name = (s3: readonly number[]) => `(${s3.map((x, p) => g.names[p][x]).join(', ')})`;
  const notes = strictlyDominated3(g).map((d) =>
    s('dominated3', { player: d.player + 1, name: g.names[d.player][d.strategy], by: g.names[d.player][d.by] }),
  );
  const isEq = (i: number, j: number, k: number) => pure.some((e) => e[0] === i && e[1] === j && e[2] === k);
  return {
    ok: true,
    answer: pure.length ? s('pureAnswer', { list: pure.map(name).join(', ') }) : s('noPure3'),
    note: notes.join('\n') || undefined,
    tables: g.names[2].map((layer, k) => ({
      caption: s('table.layer', { name: layer }),
      header: ['', ...g.names[1]],
      rows: g.names[0].map((r, i) => [
        r,
        ...g.names[1].map((_, j) => `${g.pay[i][j][k].map(fracText).join(', ')}${isEq(i, j, k) ? ' *' : ''}`),
      ]),
    })),
  };
}

const THREE: Mode = {
  id: 'three',
  fields: [
    {
      id: 'payoffs3',
      kind: 'area',
      rows: 6,
      initial: '1,1,1 0,0,0\n0,0,0 0,0,0\n\n0,0,0 0,0,0\n0,0,0 2,2,2',
      help: true,
    },
    { id: 'rows', initial: 'U D' },
    { id: 'cols', initial: 'L R' },
    { id: 'layers', initial: 'A B' },
  ],
  solve: solveWith(threeOutcome),
};

const TREE: Mode = {
  id: 'tree',
  fields: [
    {
      id: 'tree',
      kind: 'area',
      rows: 7,
      initial: 'Entrant\n  out: 0, 2\n  in: Incumbent\n    fight: -1, -1\n    accommodate: 1, 1',
      help: true,
    },
  ],
  solve: solveWith(treeOutcome),
};

const FORMULAS: Mode = {
  id: 'formulas',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['grim', 'bargain', 'rubinstein', 'auction'] },
    ...(FORMULA_FIELDS[v.kind ?? 'grim'] ?? FORMULA_FIELDS.grim).map(([id, initial]) => ({ id, initial })),
  ],
  solve: solveWith(formulaOutcome),
};

export const GAMES: ToolSpec = {
  id: 'games',
  modes: [NORMAL, THREE, TREE, FORMULAS, VOTING, STV, APPORTION, POWER, DISTRICTS, COMPACT],
};
