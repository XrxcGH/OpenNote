// Small games of 3 players in normal form: one matrix per strategy of the third player, with 3 payoffs per cell,
// typed as blocks separated by a blank line. The tool finds the pure Nash equilibria and the strictly dominated
// strategies of each player; mixed equilibria of 3-player games are left out.
//
//   1,1,1 0,2,0      (player 3 plays its first strategy)
//   2,0,0 0,0,2
//
//   0,0,2 1,1,0      (player 3 plays its second strategy)
//   2,2,2 0,0,0
import { cmp, parseFrac } from '../core/frac';
import type { Frac } from '../core/frac';
import { fail } from '../core/util';

export const MAX_THREE = 4;

export interface ThreeGame {
  /** pay[i][j][k] holds the 3 payoffs when the players take strategies i, j, k. */
  pay: Frac[][][][];
  names: [string[], string[], string[]];
}

export function parseThree(text: string, names: readonly string[] = ['', '', '']): ThreeGame {
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) =>
      b
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .filter((b) => b.length > 0);
  if (blocks.length < 2) fail('threeBlocks');
  const grids = blocks.map((b, k) =>
    b.map((line, i) =>
      line
        .split(/[\s|;]+/)
        .filter(Boolean)
        .map((cell, j) => {
          const parts = cell.split(',').map((p) => parseFrac(p));
          if (parts.length !== 3 || parts.some((p) => p === null))
            fail('threeCell', { block: k + 1, row: i + 1, col: j + 1 });
          return parts as Frac[];
        }),
    ),
  );
  const rows = grids[0].length;
  const cols = grids[0][0].length;
  if (grids.some((g) => g.length !== rows || g.some((r) => r.length !== cols))) fail('threeRagged');
  if (Math.max(rows, cols, grids.length) > MAX_THREE) fail('gameSize', { max: MAX_THREE });
  const pay = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => grids.map((g) => g[i][j])));
  const sizes = [rows, cols, grids.length];
  const named = sizes.map((n, p) => {
    const given = (names[p] ?? '').split(/[\s,]+/).filter(Boolean);
    if (given.length && given.length !== n) fail('gameNames', { n });
    return given.length ? given : Array.from({ length: n }, (_, i) => `${'RCL'[p]}${i + 1}`);
  }) as ThreeGame['names'];
  return { pay, names: named };
}

const sizesOf = (g: ThreeGame) => [g.pay.length, g.pay[0].length, g.pay[0][0].length];

/** The payoff to player p at the profile s. */
const payoff = (g: ThreeGame, s: readonly number[], p: number): Frac => g.pay[s[0]][s[1]][s[2]][p];

const withMove = (s: readonly number[], p: number, x: number) => s.map((v, q) => (q === p ? x : v));

function profiles(g: ThreeGame): number[][] {
  const [a, b, c] = sizesOf(g);
  const out: number[][] = [];
  for (let i = 0; i < a; i += 1) for (let j = 0; j < b; j += 1) for (let k = 0; k < c; k += 1) out.push([i, j, k]);
  return out;
}

/** Profiles where no player gains by moving alone. */
export function pureEquilibria3(g: ThreeGame): number[][] {
  const sizes = sizesOf(g);
  return profiles(g).filter((s) =>
    [0, 1, 2].every((p) =>
      Array.from({ length: sizes[p] }, (_, x) => x).every(
        (x) => cmp(payoff(g, withMove(s, p, x), p), payoff(g, s, p)) <= 0,
      ),
    ),
  );
}

/** For each player, its strategies that another of its strategies beats against every choice of the others. */
export function strictlyDominated3(g: ThreeGame): { player: number; strategy: number; by: number }[] {
  const sizes = sizesOf(g);
  const out: { player: number; strategy: number; by: number }[] = [];
  const all = profiles(g);
  for (let p = 0; p < 3; p += 1)
    for (let x = 0; x < sizes[p]; x += 1)
      for (let y = 0; y < sizes[p]; y += 1) {
        if (x === y) continue;
        const beaten = all
          .filter((s) => s[p] === 0)
          .every((s) => cmp(payoff(g, withMove(s, p, y), p), payoff(g, withMove(s, p, x), p)) > 0);
        if (beaten) {
          out.push({ player: p, strategy: x, by: y });
          break;
        }
      }
  return out;
}
