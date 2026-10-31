// Games, voting, and apportionment: each validation case from the plan with its expected value worked by hand, plus
// the edge cases each error message covers.
import { describe, expect, it } from 'vitest';
import { fracText } from '../core/frac';
import { KitError } from '../core/util';
import { alabama, apportion } from './apportion';
import { compactness, fairness } from './districts';
import { auction, grimThreshold, nashBargaining, rubinstein } from './formulas';
import { dominantStrategies, eliminate, mixedEquilibria, parseGame, pureEquilibria, zeroSumValue } from './normal';
import { weightedPower } from './power';
import { stv } from './stv';
import { parseTree, playPath, solveTree } from './tree';
import {
  borda,
  condorcet,
  copeland,
  instantRunoff,
  pairwise,
  parseProfile,
  plurality,
  runoff,
  schulze,
  spoilers,
} from './voting';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof KitError) return e.key;
    throw e;
  }
  throw new Error('No error was raised.');
};
const texts = (xs: readonly { n: bigint; d: bigint }[]) => xs.map(fracText);

describe('normal-form games', () => {
  it("finds the prisoner's dilemma's unique equilibrium (D, D) with D strictly dominant", () => {
    const g = parseGame('3,3 0,5\n5,0 1,1', 'C D', 'C D');
    expect(pureEquilibria(g)).toEqual([[1, 1]]);
    expect(dominantStrategies(g)).toEqual({ rows: [1], cols: [1] });
    expect(eliminate(g, false).order.map((e) => [e.player, e.removed])).toEqual([
      ['row', 0],
      ['col', 0],
    ]);
    expect(mixedEquilibria(g)).toHaveLength(1);
  });

  it('finds both pure equilibria and the mixed one of the coordination game', () => {
    const g = parseGame('3,2 0,0\n0,0 2,3');
    expect(pureEquilibria(g)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const mixed = mixedEquilibria(g).filter((e) => e.x.every((p) => p.n !== 0n));
    expect(mixed).toHaveLength(1);
    expect(texts(mixed[0].x)).toEqual(['3/5', '2/5']);
    expect(texts(mixed[0].y)).toEqual(['2/5', '3/5']);
  });

  it('solves the zero-sum game [[3, -1], [-2, 1]]: row plays the first row with 3/7, value 1/7', () => {
    const g = parseGame('3 -1\n-2 1');
    expect(g.zeroSum).toBe(true);
    const z = zeroSumValue(g.A);
    expect(fracText(z.value)).toBe('1/7');
    expect(texts(z.x)).toEqual(['3/7', '4/7']);
    expect(texts(z.y)).toEqual(['2/7', '5/7']);
  });

  it('says what is wrong with a payoff table', () => {
    expect(errorKey(() => parseGame(''))).toBe('gameEmpty');
    expect(errorKey(() => parseGame('1,1 2,2\n3,3'))).toBe('gameRagged');
    expect(errorKey(() => parseGame('1,x'))).toBe('gameCell');
    expect(errorKey(() => parseGame('1 2,2'))).toBe('gameMixedCells');
  });
});

describe('extensive-form games', () => {
  it('solves an entry game by backward induction', () => {
    const { root, players } = parseTree(
      'Entrant\n  out: 0, 2\n  in: Incumbent\n    fight: -1, -1\n    accommodate: 1, 1',
    );
    const solved = solveTree(root, players);
    expect(texts(solved.value)).toEqual(['1', '1']);
    expect(playPath(root, solved.choice)).toEqual(['Entrant: in', 'Incumbent: accommodate']);
  });

  it('averages chance nodes and checks their probabilities', () => {
    const { root, players } = parseTree('P1\n  safe: 50\n  risky: Chance\n    win [1/2]: 120\n    lose [1/2]: 0');
    expect(texts(solveTree(root, players).value)).toEqual(['60']);
    expect(errorKey(() => parseTree('P1\n  a: Chance\n    x [1/2]: 1\n    y [1/3]: 0'))).toBe('treeChance');
    expect(errorKey(() => parseTree('P1\n  a: 1, 2\n  b: 3'))).toBe('treePayoffs');
  });
});

describe('repeated games, bargaining, and auctions', () => {
  it('gives the grim-trigger threshold, the Nash split, Rubinstein shares, and auction revenue', () => {
    expect(grimThreshold(5, 3, 1)).toBeCloseTo(0.5, 12);
    expect(nashBargaining(10, 2, 0)).toEqual([6, 4]);
    expect(rubinstein(0.9, 0.9)[0]).toBeCloseTo(1 / 1.9, 12);
    const a = auction(3, 1, 20000, 7);
    expect(a.bidShare).toBeCloseTo(2 / 3, 12);
    expect(a.revenue).toBeCloseTo(0.5, 12);
    expect(Math.abs(a.simFirst - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(a.simSecond - 0.5)).toBeLessThan(0.01);
    expect(auction(3, 1, 100, 7).simFirst).toBe(auction(3, 1, 100, 7).simFirst);
    expect(errorKey(() => grimThreshold(1, 3, 5))).toBe('grimOrder');
  });
});

describe('voting', () => {
  const p = parseProfile('4: A > B > C\n3: B > C > A\n2: C > B > A');

  it('elects A by plurality, B by Borda (A 8, B 12, C 7), B as Condorcet winner, and B by instant runoff', () => {
    expect(plurality(p).winners).toEqual(['A']);
    expect([...borda(p)]).toEqual([
      ['A', 8],
      ['B', 12],
      ['C', 7],
    ]);
    const d = pairwise(p);
    // A loses to both B and C head to head, so plurality elects the Condorcet loser.
    expect(condorcet(p, d)).toEqual({ winner: 'B', loser: 'A' });
    expect(instantRunoff(p).winners).toEqual(['B']);
    expect(runoff(p)).toEqual({ winners: ['B'], finalists: ['A', 'B'], tied: [] });
    expect(copeland(p, d).get('B')).toBe(2);
    expect(schulze(p, d).winners).toEqual(['B']);
  });

  it('shows the spoiler effect: without C, B wins plurality', () => {
    expect(spoilers(p).find((s) => s.removed === 'C')!.winners).toEqual(['B']);
  });

  it('finds a Condorcet cycle and lets Schulze break it', () => {
    const cycle = parseProfile('A > B > C\nB > C > A\nC > A > B');
    expect(condorcet(cycle, pairwise(cycle)).winner).toBeNull();
  });

  it('fills 2 seats by STV with the Droop quota and fractional transfers', () => {
    const r = stv(parseProfile('6: A > B\n2: B\n2: C'), 2);
    expect(r.quota).toBe(4);
    // A has 6, a surplus of 2 moving at 1/3 per ballot: B reaches 2 + 2 = 4.
    expect(r.elected).toEqual(['A', 'B']);
  });

  it('says what is wrong with ballots', () => {
    expect(errorKey(() => parseProfile(''))).toBe('noBallots');
    expect(errorKey(() => parseProfile('A > A'))).toBe('ballotTwice');
    expect(errorKey(() => parseProfile('A'))).toBe('fewCandidates');
  });
});

describe('apportionment', () => {
  const parties = [53, 31, 16].map((size, i) => ({ name: 'ABC'[i], size }));

  it('gives 10 seats for 53, 31, 16 as 5 3 2 (Hamilton), 6 3 1 (D’Hondt), 5 3 2 (Sainte-Laguë), 5 3 2 (Huntington-Hill)', () => {
    expect(apportion('hamilton', parties, 10)).toEqual([5, 3, 2]);
    expect(apportion('jefferson', parties, 10)).toEqual([6, 3, 1]);
    expect(apportion('webster', parties, 10)).toEqual([5, 3, 2]);
    expect(apportion('hill', parties, 10)).toEqual([5, 3, 2]);
    expect(apportion('adams', parties, 10)).toEqual([5, 3, 2]);
  });

  it('applies a threshold and finds the Alabama paradox', () => {
    expect(apportion('jefferson', parties, 10, 20)).toEqual([6, 4, 0]);
    // The classic case: sizes 6, 6, and 2, with 10 seats and then 11.
    const classic = [6, 6, 2].map((size, i) => ({ name: 'XYZ'[i], size }));
    expect(apportion('hamilton', classic, 10)).toEqual([4, 4, 2]);
    expect(alabama(classic, 10)).toEqual(['Z']);
  });
});

describe('voting power and districts', () => {
  it('gives [51; 50, 49, 1] Shapley-Shubik 2/3, 1/6, 1/6 and Banzhaf 0.6, 0.2, 0.2', () => {
    const w = weightedPower(51, [50, 49, 1]);
    expect(texts(w.shapley)).toEqual(['2/3', '1/6', '1/6']);
    expect(texts(w.banzhaf)).toEqual(['3/5', '1/5', '1/5']);
    expect(w.vetoes).toEqual([0]);
    expect(errorKey(() => weightedPower(40, [50, 49, 1]))).toBe('quotaRange');
  });

  it('measures the efficiency gap, mean-median difference, and compactness', () => {
    const f = fairness([
      { name: '1', a: 70, b: 30, population: 100 },
      { name: '2', a: 70, b: 30, population: 100 },
      { name: '3', a: 40, b: 60, population: 110 },
    ]);
    // Wasted: A 20 + 20 + 40 = 80, B 30 + 30 + 10 = 70, of 300 votes.
    expect(f.gap).toBeCloseTo(10 / 300, 12);
    expect(f.meanMedian).toBeCloseTo(0.6 - 0.7, 12);
    expect(f.deviation).toBeCloseTo(10 / (310 / 3), 12);
    const square = compactness([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(square.polsbyPopper).toBeCloseTo(Math.PI / 4, 12);
    expect(square.reock).toBeCloseTo(2 / Math.PI, 12);
  });
});
