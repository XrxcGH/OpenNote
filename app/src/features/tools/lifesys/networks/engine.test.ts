// Compartment, reaction, and agent models against the planning pass's independent values (computed separately in
// Python), closed forms, exact pattern behavior, seeded properties, and the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import { createRng } from '../num/rng';
import {
  PATTERNS,
  barabasiAlbert,
  clustering,
  elementary,
  epidemicResult,
  erdosRenyi,
  finalSize,
  gillespie,
  granovetter,
  herdImmunity,
  lifeStep,
  parseNetwork,
  periodOf,
  placed,
  reedFrostExpected,
  schelling,
  solveOde,
  wattsStrogatz,
  type EpiParams,
} from './engine';

const throwsKey = (fn: () => unknown, key: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LsError);
    expect((e as LsError).key).toBe(key);
    return;
  }
  throw new Error(`expected ${key}`);
};
const value = (r: { rows: { label: string; value: number | string }[] }, label: string) =>
  r.rows.find((x) => x.label === `networks.r.${label}`)?.value as number;

describe('compartment models', () => {
  it('gives the SIR final size 0.892645 and herd-immunity threshold 0.6 for R0 2.5', () => {
    expect(finalSize(2.5)).toBeCloseTo(0.892645, 6);
    expect(herdImmunity(2.5)).toBeCloseTo(0.6, 12);
    expect(finalSize(0.9)).toBe(0);
  });

  it('matches the final size in a long SIR run', () => {
    const p: EpiParams = {
      model: 'sir',
      n: 1e6,
      i0: 1,
      beta: 0.5,
      gamma: 0.2,
      sigma: 0,
      omega: 0,
      mu: 0,
      vacc: 0,
      t: 400,
    };
    const r = epidemicResult(p);
    expect(value(r, 'r0')).toBeCloseTo(2.5, 12);
    expect(value(r, 'finalSize')).toBeCloseTo(89.2645, 3);
  });

  it('counts the vaccinated as never infected in the population final size', () => {
    // N 1000, I0 1, R0 2.5, 40% vaccinated: solve_ivp (rtol 1e-10) gives 35.1416% of N ever infected, 58.28% of the unvaccinated.
    const p = {
      model: 'sir',
      n: 1000,
      i0: 1,
      beta: 0.5,
      gamma: 0.2,
      sigma: 0,
      omega: 0,
      mu: 0,
      vacc: 0.4,
      t: 400,
    } as const;
    const r = epidemicResult(p);
    expect(value(r, 'finalSize')).toBeCloseTo(35.1416, 3);
    expect(value(r, 'finalSizeUnvacc')).toBeCloseTo(58.28, 1);
  });

  it('settles an SIS model at 1 − 1/R0 infected', () => {
    const p: EpiParams = {
      model: 'sis',
      n: 1000,
      i0: 1,
      beta: 0.5,
      gamma: 0.2,
      sigma: 0,
      omega: 0,
      mu: 0,
      vacc: 0,
      t: 400,
    };
    const r = epidemicResult(p);
    const plot = r.plots![0];
    const infected = plot.series[1].points;
    expect(infected[infected.length - 1][1]).toBeCloseTo(600, 0);
  });

  it('rejects more infected than people', () => {
    const p: EpiParams = {
      model: 'sir',
      n: 10,
      i0: 10,
      beta: 0.5,
      gamma: 0.2,
      sigma: 0,
      omega: 0,
      mu: 0,
      vacc: 0,
      t: 10,
    };
    throwsKey(() => epidemicResult(p), 'networks.e.i0');
  });

  it('runs the Reed-Frost recursion', () => {
    const course = reedFrostExpected(3, 1, 0.5, 2);
    // Generation 1: 2 × (1 − 0.5) = 1 case.
    expect(course[1].i).toBeCloseTo(1, 12);
    expect(course[1].s).toBeCloseTo(1, 12);
  });
});

describe('reaction networks', () => {
  it('parses reactions with sources, sinks, and rate laws', () => {
    const net = parseNetwork('-> M, 2\nM -> M + P, 10\n2 A -> B, 0.1\nS -> P, mm(5, 2)\n-> U, rep(V, 50, 10, 2)');
    expect(net.reactions).toHaveLength(5);
    expect(net.reactions[2].reactants).toEqual({ A: 2 });
    expect(net.reactions[3].rate).toEqual({ kind: 'mm', vmax: 5, km: 2 });
    expect(net.species).toContain('V');
  });

  it('refuses malformed lines', () => {
    throwsKey(() => parseNetwork('A B, 1'), 'networks.e.line');
    throwsKey(() => parseNetwork('A -> B, fast'), 'networks.e.rate');
    throwsKey(() => parseNetwork('A + 2 -> B, 1'), 'networks.e.term');
    throwsKey(() => parseNetwork('A + B -> C, mm(1, 2)'), 'networks.e.mm');
    throwsKey(() => parseNetwork('# nothing'), 'networks.e.noReactions');
  });

  it('gives A(2) = 36.7879 for A -> B with k 0.5 and A0 100', () => {
    const sol = solveOde(parseNetwork('A -> B, 0.5'), { A: 100, B: 0 }, 2);
    const last = sol.y[sol.y.length - 1];
    expect(last[0]).toBeCloseTo(36.7879, 4);
    expect(last[0] + last[1]).toBeCloseTo(100, 9);
  });

  it('brings 2000 seeded birth-death runs within 3% of 10 e', () => {
    const ssa = gillespie(parseNetwork('N -> 2 N, 1\nN -> , 0.5'), { N: 10 }, 2, 2000, 42);
    const mean = ssa.stats[0][ssa.grid.length - 1].mean;
    expect(Math.abs(mean - 10 * Math.E) / (10 * Math.E)).toBeLessThan(0.03);
  });

  it('repeats exactly for the same seed', () => {
    const net = parseNetwork('N -> 2 N, 1\nN -> , 0.5');
    expect(gillespie(net, { N: 10 }, 2, 20, 7).stats[0][100].mean).toBe(
      gillespie(net, { N: 10 }, 2, 20, 7).stats[0][100].mean,
    );
  });
});

describe('grids and automata', () => {
  it('gives the blinker period 2 and the glider period 4 with a shift of (1, 1)', () => {
    expect(periodOf(placed(PATTERNS.blinker, 10), 10)).toEqual({ period: 2, dr: 0, dc: 0 });
    expect(periodOf(placed(PATTERNS.glider, 12), 12)).toEqual({ period: 4, dr: 1, dc: 1 });
  });

  it('keeps a block still', () => {
    const block = placed(
      [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ],
      6,
    );
    expect(lifeStep(block, 6)).toEqual(block);
  });

  it('grows rule 90 into the Sierpiński pattern', () => {
    const rows = elementary(90, 9, 3, 'single', 0);
    expect(rows[1].join('')).toBe('000101000');
    expect(rows[2].join('')).toBe('001000100');
  });

  it('raises the like-neighbor share in Schelling for several seeds', () => {
    for (const seed of [1, 2, 3]) {
      const s = schelling(20, 0.1, 0.3, seed, 200);
      expect(s.history[s.history.length - 1][1]).toBeGreaterThan(s.history[0][1]);
      expect(s.settled || s.steps === 200).toBe(true);
    }
  });

  it('cascades fully for uniform thresholds and stalls when the first step is missing', () => {
    const n = 100;
    const uniform = Array.from({ length: n }, (_, i) => i / n);
    expect(granovetter(uniform).at(-1)![1]).toBe(1);
    const gap = uniform.map((t, i) => (i === 1 ? 0.5 : t));
    expect(granovetter(gap).at(-1)![1]).toBeCloseTo(0.01, 12);
  });
});

describe('random networks', () => {
  it('gives an Erdős-Rényi mean degree near (n − 1) p', () => {
    const g = erdosRenyi(500, 0.02, createRng(3));
    const mean = g.reduce((s, x) => s + x.size, 0) / 500;
    expect(Math.abs(mean - 499 * 0.02)).toBeLessThan(1);
  });

  it('keeps a ring lattice’s clustering of 0.5 with no rewiring', () => {
    const g = wattsStrogatz(100, 4, 0, createRng(1));
    expect(clustering(g)).toBeCloseTo(0.5, 12);
  });

  it('gives Barabási-Albert graphs about 2m edges per node', () => {
    const g = barabasiAlbert(300, 2, createRng(5));
    const edges = g.reduce((s, x) => s + x.size, 0) / 2;
    expect(edges).toBe(3 + (300 - 3) * 2);
  });
});
