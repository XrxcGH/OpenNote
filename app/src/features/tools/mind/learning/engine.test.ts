// The learning engines against the planned cases. Expected values are worked by hand in the comments.
import { describe, expect, it } from 'vitest';
import { makeRng } from '../kit/rng';
import { MindError } from '../kit/types';
import { associate, readPhases, tdTimeline } from './associative';
import { banditRuns, runBandit } from './bandit';
import { applySchedule, curveAt, fitCurve, steadyStream } from './behavior';
import { learnGrid, policyIteration, qUpdate, readGrid, valueIteration } from './grid';

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

const RATES = { alpha: {}, alphaDefault: 0.3, betaPlus: 1, betaMinus: 1, lambda: 1 };

describe('Rescorla-Wagner', () => {
  it('gives V 0.3, 0.51, 0.657 on the first 3 trials of 1 cue', () => {
    // V += 0.3 (1 - V): 0.3; 0.3 + 0.3 x 0.7 = 0.51; 0.51 + 0.3 x 0.49 = 0.657.
    const r = associate(readPhases('1 | A+ x3'), RATES);
    expect(r.trials.map((t) => t.v.A)).toEqual([0.3, 0.51, 0.657].map((v) => expect.closeTo(v, 12)));
  });

  it('blocks B after A is learned: V_A 0.971752, V_B 0.0141223', () => {
    const r = associate(readPhases('1 | A+ x10\n2 | AB+ x10'), RATES);
    // After 10 A+ trials, V_A = 1 - 0.7^10.
    expect(r.afterPhase[0].A).toBeCloseTo(1 - Math.pow(0.7, 10), 12);
    expect(r.afterPhase[0].A).toBeCloseTo(0.971752, 6);
    expect(r.afterPhase[1].B).toBeCloseTo(0.0141223, 7);
  });

  it('alternates trial types within a phase and extinguishes without the US', () => {
    const phases = readPhases('train | A+ x2, B- x2\next | A- x1');
    expect(phases[0].order.map((t) => t.label)).toEqual(['A+', 'B-', 'A+', 'B-']);
    const r = associate(phases, RATES);
    // A: 0.3, 0.51; then A- gives 0.51 - 0.3 x 0.51 = 0.357.
    expect(r.afterPhase[1].A).toBeCloseTo(0.357, 12);
    expect(r.afterPhase[0].B).toBe(0);
  });

  it('scales changes by associability in the Pearce-Hall variant', () => {
    // Associability starts at 1, so trial 1 matches Rescorla-Wagner; then it becomes 0.5 x |1| + 0.5 x 1 = 1,
    // and after trial 2 (error 0.7) it is 0.5 x 0.7 + 0.5 = 0.85.
    const r = associate(readPhases('1 | A+ x3'), RATES, 0.5);
    expect(r.trials[0].v.A).toBeCloseTo(0.3, 12);
    expect(r.trials[1].assoc.A).toBeCloseTo(0.85, 12);
    expect(r.trials[2].v.A).toBeCloseTo(0.51 + 0.3 * 0.85 * 0.49, 12);
  });

  it('stops on a trial type it cannot read', () => {
    expect(code(() => readPhases('1 | A x3'))).toBe('trialType');
    expect(code(() => readPhases('1 | A+ x9999'))).toBe('tooManyTrials');
  });
});

describe('TD(0)', () => {
  it('moves the prediction error from the reward to the cue', () => {
    const r = tdTimeline(6, 1, 4, 1, 0.3, 1, 400);
    const first = r.errors[0];
    const last = r.errors[r.errors.length - 1];
    // Trial 1: nothing is predicted, so the whole error is at the reward.
    expect(first[4]).toBeCloseTo(1, 12);
    expect(first[1]).toBe(0);
    // Trained: the error is at the cue (gamma V = 1) and none is left at the reward.
    expect(last[1]).toBeCloseTo(1, 6);
    expect(last[4]).toBeCloseTo(0, 6);
    expect(code(() => tdTimeline(5, 3, 2, 1, 0.1, 1, 1))).toBe('tdOrder');
  });
});

describe('grid world', () => {
  it('gives one Q-learning update of 1.4', () => {
    // 0 + 0.5 (1 + 0.9 x 2 - 0) = 1.4.
    expect(qUpdate(0, 0.5, 1, 0.9, 2)).toBeCloseTo(1.4, 12);
  });

  it('solves the chain s0, s1, goal: V(s1) 9, V(s0) 8.1', () => {
    const g = readGrid('S . G', 10, -10, 0, 0);
    const v = valueIteration(g, 0.9);
    expect(v.V[1]).toBeCloseTo(9, 12);
    expect(v.V[0]).toBeCloseTo(8.1, 12);
    expect(v.policy.slice(0, 2)).toEqual([1, 1]);
    const p = policyIteration(g, 0.9);
    expect(p.V[0]).toBeCloseTo(8.1, 9);
    expect(p.policy).toEqual(v.policy);
  });

  it('learns the same policy with Q-learning and SARSA on a small grid', () => {
    const g = readGrid('S . . G\n. # . X\n. . . .', 10, -10, -0.1, 0);
    const best = valueIteration(g, 0.9).policy;
    const q = learnGrid(g, 'q', 0.5, 0.9, 0.2, 800, makeRng(3));
    expect(q.policy[g.start]).toBe(best[g.start]);
    const s = learnGrid(g, 'sarsa', 0.5, 0.9, 0.1, 800, makeRng(3));
    expect(s.policy[g.start]).toBe(best[g.start]);
  });

  it('takes slips into account', () => {
    // With a slip of 0.2 next to a pit, the expected value of moving right from s1 is below the slip-free one.
    const g = readGrid('. . G\n. . X', 10, -10, 0, 0.2);
    const still = readGrid('. . G\n. . X', 10, -10, 0, 0);
    expect(valueIteration(g, 0.9).V[1]).toBeLessThan(valueIteration(still, 0.9).V[1]);
  });

  it('stops on a grid without a terminal cell or with an unknown cell', () => {
    expect(code(() => readGrid('S . .', 10, -10, 0, 0))).toBe('gridGoal');
    expect(code(() => readGrid('S ? G', 10, -10, 0, 0))).toBe('gridCell');
    expect(code(() => readGrid('S .\n. . G', 10, -10, 0, 0))).toBe('gridRagged');
  });
});

describe('bandits', () => {
  const fixed = { means: [1, 2], payout: 'gaussian' as const, sd: 0, strategy: 'greedy' as const, param: 0, start: 5 };

  it('pulls arm 2 every time after one pull of each arm, with sample averages', () => {
    // Optimistic Q = 5 for both: pull 1 (tie, lowest arm) gives Q1 = 1; pull 2 gives Q2 = 2; then 2 > 1 forever.
    const run = runBandit({ ...fixed, rate: 'average' }, 20, makeRng(1));
    expect(run.choices.slice(0, 2)).toEqual([0, 1]);
    expect(run.choices.slice(2).every((a) => a === 1)).toBe(true);
  });

  it('with a constant rate of 0.5 returns to arm 1 once, then settles on arm 2', () => {
    // Q1: 5 -> 3; Q2: 5 -> 3.5 -> 2.75; arm 1 (3 > 2.75): 3 -> 2; then Q2 falls toward 2 from above and stays ahead.
    const run = runBandit({ ...fixed, rate: 0.5 }, 20, makeRng(1));
    expect(run.choices.slice(0, 4)).toEqual([0, 1, 1, 0]);
    expect(run.choices.slice(4).every((a) => a === 1)).toBe(true);
  });

  it('gives UCB1 and Thompson sampling less regret than pure exploration', () => {
    const base = { means: [0.2, 0.5, 0.7], payout: 'bernoulli' as const, sd: 0, start: 0, rate: 'average' as const };
    const random = banditRuns({ ...base, strategy: 'greedy', param: 1 }, 300, 40, makeRng(5));
    const ucb = banditRuns({ ...base, strategy: 'ucb', param: Math.SQRT2 }, 300, 40, makeRng(5));
    const ts = banditRuns({ ...base, strategy: 'thompson', param: 0 }, 300, 40, makeRng(5));
    expect(ucb.regret[299]).toBeLessThan(random.regret[299]);
    expect(ts.regret[299]).toBeLessThan(random.regret[299]);
    // Pure exploration: regret grows by the mean shortfall, (0.5 + 0.2 + 0) / 3 per pull.
    expect(random.regret[299] / 300).toBeCloseTo(0.7 / 3, 1);
  });

  it('stops on 1 arm and on Bernoulli means outside 0 to 1', () => {
    expect(code(() => runBandit({ ...fixed, means: [1], rate: 'average' }, 5, makeRng(1)))).toBe('fewArms');
    expect(code(() => runBandit({ ...fixed, payout: 'bernoulli', rate: 'average' }, 5, makeRng(1)))).toBe(
      'bernoulliMeans',
    );
  });
});

describe('schedules and curves', () => {
  const stream = steadyStream(60, 30);

  it('reinforces every 5th response on FR 5 and the first after 10 s on FI 10', () => {
    expect(stream).toHaveLength(30);
    expect(applySchedule(stream, 'FR', 5, makeRng(1)).reinforced).toEqual([4, 9, 14, 19, 24, 29]);
    // Responses at 1, 2, ... s: the first at or after 10 s is at 10 s, then 20 s, then 30 s.
    expect(applySchedule(stream, 'FI', 10, makeRng(1)).reinforced).toEqual([9, 19, 29]);
  });

  it('gives variable schedules whose requirements average near their value', () => {
    const many = steadyStream(60, 20000);
    const vr = applySchedule(many, 'VR', 10, makeRng(2));
    const mean = vr.requirements.reduce((s, x) => s + x, 0) / vr.requirements.length;
    expect(Math.abs(mean - 10)).toBeLessThan(0.5);
    expect(code(() => applySchedule(stream, 'VR', 2.5, makeRng(1)))).toBe('whole');
  });

  it('recovers exact exponential and power-law curves', () => {
    const ts = [1, 2, 3, 4, 5, 6, 8, 10];
    const exp = { a: 2, b: 5, c: 0.4 };
    const e = fitCurve(
      ts,
      ts.map((t) => curveAt('exponential', t, exp)),
      'exponential',
    );
    expect(e.c).toBeCloseTo(0.4, 5);
    expect(e.a).toBeCloseTo(2, 5);
    const pow = { a: 1, b: 9, c: 0.7 };
    const p = fitCurve(
      ts,
      ts.map((t) => curveAt('power', t, pow)),
      'power',
    );
    expect(p.c).toBeCloseTo(0.7, 5);
    expect(p.r2).toBeCloseTo(1, 9);
    expect(code(() => fitCurve([0, 1, 2, 3], [4, 3, 2, 1], 'power'))).toBe('powerTrials');
  });
});
