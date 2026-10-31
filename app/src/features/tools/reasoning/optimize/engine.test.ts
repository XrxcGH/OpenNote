// The optimization tool's engines against the planning pass's validation cases (worked by hand and checked with
// SciPy), with brute-force cross-checks and the edge cases each engine must word rather than throw on.
import { describe, expect, it } from 'vitest';
import { fracText, toNumber } from '../core/frac';
import { solveLp } from '../core/simplex';
import { KitError } from '../core/util';
import { hungarian } from './assign';
import { decide, sensitivity } from './decision';
import { parseLp } from './linear';
import { branchAndBound, costRanges, dual, objectiveAt, rhsRanges } from './lp';
import { mmc, newsvendor } from './ops';
import { cpm, crash, earnedValue, normalCdf, parseActivities, parseCrash } from './project';
import { transport } from './transport';

const errorKey = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof KitError) return e.key;
    throw e;
  }
  return 'none';
};

describe('linear programs', () => {
  const p = parseLp('max 3x + 2y', 'x + y <= 4\nx + 3y <= 6\nx <= 3\nx >= 0\ny >= 0');

  it('solves the validation program: x 3, y 1, z 11', () => {
    const r = solveLp(p.lp);
    expect(r.status).toBe('optimal');
    expect(r.x.map(fracText)).toEqual(['3', '1']);
    expect(fracText(r.z)).toBe('11');
  });

  it('gives shadow prices that solve the dual (the case is degenerate, so 0, 2/3, 7/3 is one of several)', () => {
    const r = solveLp(p.lp);
    expect(r.degenerate).toBe(true);
    const y = r.duals.map(toNumber);
    // Dual feasibility y A >= c and y >= 0, and b y = z: the conditions the SciPy answer (0, 2/3, 7/3) also meets.
    expect(y.every((v) => v >= -1e-12)).toBe(true);
    expect(y[0] + y[1] + y[2]).toBeGreaterThanOrEqual(3 - 1e-12);
    expect(y[0] + 3 * y[1]).toBeGreaterThanOrEqual(2 - 1e-12);
    expect(4 * y[0] + 6 * y[1] + 3 * y[2]).toBeCloseTo(11, 12);
    const scipy = [0, 2 / 3, 7 / 3];
    expect(4 * scipy[0] + 6 * scipy[1] + 3 * scipy[2]).toBeCloseTo(11, 12);
  });

  it('ranges a right side and an objective coefficient on a nondegenerate program', () => {
    // max 3x + 5y; x <= 4, 2y <= 12, 3x + 2y <= 18: x 2, y 6, z 36 (the classic Wyndor example).
    const w = parseLp('max 3x + 5y', 'x <= 4\n2y <= 12\n3x + 2y <= 18');
    const r = solveLp(w.lp);
    expect(fracText(r.z)).toBe('36');
    expect(r.duals.map(fracText)).toEqual(['0', '3/2', '1']);
    const rhs = rhsRanges(w.lp, r);
    // By hand: b2 may move from 6 to 18, b3 from 12 to 24; b1 from 2 upward.
    expect(rhs.map((g) => [g.lo && fracText(g.lo), g.hi && fracText(g.hi)])).toEqual([
      ['2', null],
      ['6', '18'],
      ['12', '24'],
    ]);
    const cost = costRanges(w.lp, r);
    // By hand: c1 in [0, 7.5], c2 at least 2.
    expect(cost.map((g) => [g.lo && fracText(g.lo), g.hi && fracText(g.hi)])).toEqual([
      ['0', '15/2'],
      ['2', null],
    ]);
  });

  it('writes the dual with the sign of each dual variable', () => {
    const d = dual(parseLp('max 3x + 2y', 'x + y <= 4\nx + y >= 1\nx - y = 0').lp);
    expect(d.sense).toBe('min');
    expect(d.signs).toEqual(['>=', '<=', 'free']);
    expect(d.rows.map((r) => r.op)).toEqual(['>=', '>=']);
  });

  it('reports infeasible and unbounded programs', () => {
    expect(solveLp(parseLp('max x', 'x <= 1\nx >= 2').lp).status).toBe('infeasible');
    expect(solveLp(parseLp('max x + y', 'x - y <= 1').lp).status).toBe('unbounded');
  });

  it('words bad input', () => {
    expect(errorKey(() => parseLp('', 'x <= 1'))).toBe('lpSense');
    expect(errorKey(() => parseLp('max x', ''))).toBe('lpNoRows');
    expect(errorKey(() => parseLp('max x', 'x 4'))).toBe('lpNoOp');
  });
});

describe('integer programs', () => {
  it('branches to the whole-number optimum, matching an exhaustive search', () => {
    const p = parseLp('max 5x + 4y', '6x + 4y <= 24\nx + 2y <= 6');
    const r = branchAndBound(p.lp, [true, true]);
    let best = -Infinity;
    for (let x = 0; x <= 4; x += 1)
      for (let y = 0; y <= 6; y += 1) if (6 * x + 4 * y <= 24 && x + 2 * y <= 6) best = Math.max(best, 5 * x + 4 * y);
    expect(best).toBe(20);
    expect(r.best && fracText(r.best.z)).toBe('20');
    expect(r.best && fracText(objectiveAt(p.lp, r.best.x))).toBe('20');
    expect(r.root.fate).toBe('branch');
    expect(fracText(r.root.z)).toBe('21');
  });

  it('finds no integer point in a thin slab', () => {
    const p = parseLp('max x', '2x >= 1\n2x <= 1');
    expect(branchAndBound(p.lp, [true]).best).toBeNull();
  });
});

describe('transportation', () => {
  it('reaches the minimum cost 465 from either start', () => {
    for (const start of ['northwest', 'vogel'] as const) {
      const r = transport(
        [
          [8, 6, 10],
          [9, 12, 13],
        ],
        [20, 30],
        [10, 25, 15],
        start,
      );
      expect(r.plan.total).toBe(465);
      expect(r.dummy).toBeNull();
    }
  });

  it('agrees with the simplex on the same program', () => {
    const p = parseLp(
      'min 8a + 6b + 10c + 9d + 12e + 13f',
      'a + b + c = 20\nd + e + f = 30\na + d = 10\nb + e = 25\nc + f = 15',
    );
    expect(fracText(solveLp(p.lp).z)).toBe('465');
  });

  it('adds a dummy destination when supply is larger', () => {
    const r = transport([[1, 2]], [10], [3, 4], 'northwest');
    expect(r.dummy).toBe('destination');
    expect(r.plan.total).toBe(3 + 8);
  });

  it('handles a degenerate start', () => {
    const r = transport(
      [
        [4, 6],
        [5, 3],
      ],
      [10, 10],
      [10, 10],
      'northwest',
    );
    expect(r.plan.total).toBe(70);
  });

  it('words bad input', () => {
    expect(errorKey(() => transport([[1, 2]], [1, 2], [1, 1], 'vogel'))).toBe('trSupply');
    expect(errorKey(() => transport([[1, 2]], [-1], [1, 1], 'vogel'))).toBe('trNegative');
    expect(errorKey(() => transport([[1]], [0], [0], 'vogel'))).toBe('trNoSupply');
  });
});

describe('assignment', () => {
  const brute = (m: number[][]) => {
    const n = m.length;
    let best = Infinity;
    const go = (i: number, used: number, s: number) => {
      if (i === n) best = Math.min(best, s);
      else for (let j = 0; j < n; j += 1) if (!(used & (1 << j))) go(i + 1, used | (1 << j), s + m[i][j]);
    };
    go(0, 0, 0);
    return best;
  };

  it('assigns rows to columns 2, 1, 3 for a total of 5', () => {
    const m = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const r = hungarian(m);
    expect(r.total).toBe(5);
    expect(brute(m)).toBe(5);
    expect(r.match).toEqual([1, 0, 2]);
  });

  it('matches an exhaustive search on matrices that need line adjustments', () => {
    const cases = [
      [
        [9, 2, 7, 8],
        [6, 4, 3, 7],
        [5, 8, 1, 8],
        [7, 6, 9, 4],
      ],
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
      [
        [10, 19, 8, 15],
        [10, 18, 7, 17],
        [13, 16, 9, 14],
        [12, 19, 8, 18],
      ],
    ];
    for (const m of cases) expect(hungarian(m).total).toBe(brute(m));
  });

  it('maximizes and pads a rectangular matrix', () => {
    expect(
      hungarian(
        [
          [1, 5],
          [4, 2],
        ],
        true,
      ).total,
    ).toBe(9);
    expect(hungarian([[3, 1, 2]]).total).toBe(1);
  });

  it('words an empty matrix', () => {
    expect(errorKey(() => hungarian([]))).toBe('asEmpty');
  });
});

describe('project networks', () => {
  it('finds the critical path A-C-D of length 9, with float 2 on B', () => {
    const s = cpm(parseActivities('A 3\nB 2 | A\nC 4 | A\nD 2 | B, C'));
    expect(s.length).toBe(9);
    expect(s.paths).toEqual([['A', 'C', 'D']]);
    expect(s.slack[1]).toBe(2);
    expect(s.critical).toEqual([true, false, true, true]);
  });

  it('gives a PERT mean of 4 and a variance of 0.4444 for estimates 2, 4, 6', () => {
    const [a] = parseActivities('A 2 4 6');
    expect(a.dur).toBeCloseTo(4, 12);
    expect(a.variance).toBeCloseTo(4 / 9, 4);
  });

  it('gives the chance of finishing by a deadline from the normal curve', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
  });

  it('words cycles, unknown predecessors, and bad estimates', () => {
    expect(errorKey(() => cpm(parseActivities('A 1 | B\nB 1 | A')))).toBe('pmCycle');
    expect(errorKey(() => parseActivities('A 1 | Z'))).toBe('pmUnknown');
    expect(errorKey(() => parseActivities('A 6 4 2'))).toBe('pmOrder');
    expect(errorKey(() => parseActivities('A -1'))).toBe('pmNegative');
    expect(errorKey(() => parseActivities(''))).toBe('pmEmpty');
  });

  it('works out earned value by hand', () => {
    const e = earnedValue(100, 50, 40, 45);
    expect(e.cv).toBe(-5);
    expect(e.sv).toBe(-10);
    expect(e.cpi).toBeCloseTo(40 / 45, 12);
    expect(e.spi).toBeCloseTo(0.8, 12);
    expect(e.eac).toBeCloseTo(112.5, 12);
    expect(e.tcpi).toBeCloseTo(60 / 55, 12);
    expect(errorKey(() => earnedValue(0, 1, 1, 1))).toBe('evBudget');
  });
});

describe('decisions', () => {
  it('prefers the gamble with EMV 60 over a sure 50, and EVPI is 25', () => {
    const r = decide(
      [
        [50, 50],
        [120, 0],
      ],
      [0.5, 0.5],
      null,
      null,
    );
    expect(r.emv).toEqual([50, 60]);
    expect(r.best).toBe(1);
    expect(r.evpi).toBe(25);
    expect(r.maximin).toEqual([50, 0]);
    expect(r.maxRegret).toEqual([70, 50]);
  });

  it('values sample information by Bayes, never above perfect information', () => {
    // A test that reads the good state right 80% of the time; by hand: P(good signal) = 0.5, posterior 0.8 and 0.2,
    // EV after good = 96 (gamble), after bad = 50 (sure), EVwSI = 73, EVSI = 13.
    const r = decide(
      [
        [50, 50],
        [120, 0],
      ],
      [0.5, 0.5],
      [
        [0.8, 0.2],
        [0.2, 0.8],
      ],
      null,
    );
    expect(r.sample!.pSignal).toEqual([0.5, 0.5]);
    expect(r.sample!.valueBy[0]).toBeCloseTo(96, 12);
    expect(r.sample!.evsi).toBeCloseTo(13, 12);
    expect(r.sample!.evsi).toBeLessThanOrEqual(r.evpi);
  });

  it('gives certainty equivalents below the EMV for a risk-averse decision maker', () => {
    const r = decide([[120, 0]], [0.5, 0.5], null, 100);
    // CE = -100 ln(0.5 e^-1.2 + 0.5) by hand.
    expect(r.certainty![0]).toBeCloseTo(-100 * Math.log(0.5 * Math.exp(-1.2) + 0.5), 12);
    expect(r.certainty![0]).toBeLessThan(60);
  });

  it('words probabilities that do not add to 1', () => {
    expect(errorKey(() => decide([[1, 2]], [0.5, 0.6], null, null))).toBe('dcProbSum');
    expect(errorKey(() => decide([[1, 2]], [1], null, null))).toBe('dcProbCount');
  });
});

describe('operations', () => {
  it('works out M/M/2 with arrivals 4 and service 3 per hour', () => {
    const q = mmc(4, 3, 2);
    expect(q.p0).toBeCloseTo(0.2, 12);
    expect(q.lq).toBeCloseTo(1.0667, 4);
    expect(q.wq).toBeCloseTo(0.2667, 4);
    expect(q.l).toBeCloseTo(2.4, 12);
    // Little's law holds both ways.
    expect(q.l).toBeCloseTo(4 * q.w, 12);
  });

  it('matches M/M/1 closed forms, and refuses an unstable queue', () => {
    const q = mmc(2, 3, 1);
    expect(q.l).toBeCloseTo(2 / (3 - 2), 12);
    expect(errorKey(() => mmc(6, 3, 2))).toBe('qUnstable');
    expect(errorKey(() => mmc(1, 1, 0))).toBe('qServers');
    expect(mmc(400, 1, 450).rho).toBeCloseTo(400 / 450, 12);
  });

  it('orders 106.37 for a newsvendor with costs 5 and 3 and demand N(100, 20)', () => {
    const r = newsvendor(5, 3, 100, 20);
    expect(r.ratio).toBe(0.625);
    expect(r.z).toBeCloseTo(0.31864, 4);
    expect(r.q).toBeCloseTo(106.37, 2);
    expect(errorKey(() => newsvendor(0, 3, 100, 20))).toBe('nvCosts');
  });
});

describe('crashing a project network', () => {
  const acts = parseActivities('A 3\nB 2 | A\nC 4 | A\nD 2 | B, C');
  it('shortens the cheapest cut of the critical paths each round', () => {
    // A-C-D is 9 and A-B-D is 7. C (50) twice takes it to 7, where both paths are critical; then the cheapest cut
    // of both, with C used up, is D (80) rather than A (100): 50 + 50 + 80 = 180 for a length of 6.
    const r = crash(acts, parseCrash('A 2 100\nC 2 50\nD 1 80\nB 1 30', acts), 6);
    expect(r.rounds.map((x) => x.names.join('+'))).toEqual(['C', 'C', 'D']);
    expect([r.length, r.cost, r.stuck]).toEqual([6, 180, false]);
  });
  it('stops when the critical path cannot be shortened further', () => {
    // Only C can move, from 4 to 3: 9 becomes 8, and nothing else can come off.
    const r = crash(acts, parseCrash('C 3 10', acts), 5);
    expect([r.length, r.cost, r.stuck]).toEqual([8, 10, true]);
    expect(() => parseCrash('Z 1 5', acts)).toThrow();
    expect(() => parseCrash('C 5 5', acts)).toThrow();
  });
});

describe('decision sensitivity', () => {
  it('finds where the best alternative changes with the first state probability', () => {
    // EMV(sure) = 50 and EMV(gamble) = 120 p cross at p = 50 / 120 = 0.41667.
    const r = sensitivity(
      [
        [50, 50],
        [120, 0],
      ],
      [0.5, 0.5],
    )!;
    expect(r.ends).toEqual([
      [50, 50],
      [0, 120],
    ]);
    expect(r.stretches.map((x) => x.best)).toEqual([0, 1]);
    expect(r.stretches[0].to).toBeCloseTo(5 / 12, 12);
    // Three states: the last two share 1 - p as 1 : 3, so gamble's p = 0 end is (1 * 0 + 3 * 40) / 4 = 30.
    const [zero, one] = sensitivity([[10, 0, 40]], [0.2, 0.2, 0.6])!.ends[0];
    expect([zero, one]).toEqual([expect.closeTo(30, 12), 10]);
  });
});
