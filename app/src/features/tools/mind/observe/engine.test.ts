// The observation engine against the planned cases, each worked by hand in the comments.
import { describe, expect, it } from 'vitest';
import { MindError } from '../kit/types';
import {
  observers,
  overlap,
  phaseSummary,
  readEthogram,
  readLog,
  readPhases,
  readRecord,
  scoreIntervals,
  summarize,
} from './engine';

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

const ETHOGRAM = readEthogram('rest | state | activity\nfeed | state | activity\ncall | event');

describe('a session log', () => {
  it('gives the time budget and bout length of mutually exclusive states', () => {
    // rest 0-30 and 75-120 is 75 s of 120 (62.5%); feed 30-75 is 45 s (37.5%), 1 bout of 45 s.
    const marks = readLog('0 | rest\n30 | feed\n75 | rest', ETHOGRAM, 120);
    const r = summarize(marks, ETHOGRAM, 120);
    const [rest, feed] = r.behaviors;
    expect(rest.budget).toBeCloseTo(0.625, 9);
    expect(feed.budget).toBeCloseTo(0.375, 9);
    expect(feed.meanBout).toBeCloseTo(45, 9);
    expect(rest.count).toBe(2);
    expect(feed.latency).toBe(30);
    expect(r.sequence).toEqual(['rest', 'feed', 'rest']);
    expect(r.transitions[0][1]).toBe(1);
    expect(r.transitions[1][0]).toBe(1);
  });

  it('gives a rate of 2.5 per minute for 5 events in 2 minutes', () => {
    const marks = readLog('5 | call\n12 | call\n40 | call\n41 | call\n90 | call', ETHOGRAM, 120);
    const call = summarize(marks, ETHOGRAM, 120).behaviors[2];
    expect(call.count).toBe(5);
    expect(call.rate).toBeCloseTo(2.5, 12);
    expect(call.latency).toBe(5);
    expect(call.budget).toBeNaN();
  });

  it('ends a state at its stop mark and ignores a second start', () => {
    const marks = readLog('10 | rest\n15 | rest\n20 | rest | stop', ETHOGRAM, 60);
    const rest = summarize(marks, ETHOGRAM, 60).behaviors[0];
    expect(rest.total).toBe(10);
    expect(rest.count).toBe(1);
  });

  it('stops on marks out of order, outside the session, or for an unknown behavior', () => {
    expect(code(() => readLog('20 | rest\n10 | feed', ETHOGRAM, 60))).toBe('logOrder');
    expect(code(() => readLog('70 | rest', ETHOGRAM, 60))).toBe('logTime');
    expect(code(() => readLog('-1 | rest', ETHOGRAM, 60))).toBe('logTime');
    expect(code(() => readLog('5 | sleep', ETHOGRAM, 60))).toBe('unknownBehavior');
    expect(code(() => readEthogram('rest | mood'))).toBe('ethogramLine');
    expect(code(() => summarize([], ETHOGRAM, 0))).toBe('positive');
  });
});

describe('interval recording', () => {
  const ethogram = readEthogram('tap | state');
  const marks = readLog('3 | tap\n4 | tap | stop\n25 | tap\n28 | tap | stop', ethogram, 40);
  const session = summarize(marks, ethogram, 40);

  it('scores intervals 1 and 3 of 4 with partial-interval recording', () => {
    expect(scoreIntervals('tap', session, [], 10, 40, 'partial')).toEqual([1, 0, 1, 0]);
  });

  it('scores no interval as whole, and a momentary sample only when the state runs at its end', () => {
    expect(scoreIntervals('tap', session, [], 10, 40, 'whole')).toEqual([0, 0, 0, 0]);
    // With 2 s intervals over 6 s, the samples fall at 2, 4, and 6 s; tap runs from 3 up to 4 s, so it has ended
    // at the 4 s sample. With 3 s intervals over 6 s, the 3 s sample falls as tap starts and sees it.
    expect(scoreIntervals('tap', session, [], 2, 6, 'momentary')).toEqual([0, 0, 0]);
    expect(scoreIntervals('tap', session, [], 3, 6, 'momentary')).toEqual([1, 0]);
  });

  it('sees exactly one of 2 exclusive states at each scan, a new state at its first instant', () => {
    // rest 0-30, feed 30-75, rest 75-120; scans at 30, 60, 90, 120 s. At 30 s feed has begun and rest has ended;
    // at 120 s, the session's end, rest is still running.
    const log = readLog('0 | rest\n30 | feed\n75 | rest', ETHOGRAM, 120);
    const s = summarize(log, ETHOGRAM, 120);
    const feed = scoreIntervals('feed', s, [], 30, 120, 'momentary');
    const rest = scoreIntervals('rest', s, [], 30, 120, 'momentary');
    expect(feed).toEqual([1, 1, 0, 0]);
    expect(rest).toEqual([0, 0, 1, 1]);
  });

  it('counts an event at the start of an interval in that interval', () => {
    expect(scoreIntervals('x', session, [10, 19.9], 10, 30, 'partial')).toEqual([0, 1, 0]);
  });

  it('stops on an interval longer than the session', () => {
    expect(code(() => scoreIntervals('tap', session, [], 50, 40, 'partial'))).toBe('intervalLong');
  });
});

describe('two observers', () => {
  it('gives interval-by-interval, occurrence, and nonoccurrence agreement', () => {
    // 10 intervals, they differ on 2: 80%. Either scored it on 6, both on 4: 4/6. Either left it on 6, both on 4: 4/6.
    const r = observers(readRecord('1100110010', 'first'), readRecord('1 0 0 1 1 1 0 0 1 0', 'second'));
    expect(r.total).toBeCloseTo(0.8, 12);
    expect(r.occurrence).toBeCloseTo(4 / 6, 12);
    expect(r.nonoccurrence).toBeCloseTo(4 / 6, 12);
    // Both score 1 on 5 of 10, so pe = 0.5 and kappa = 0.6.
    expect(r.kappa).toBeCloseTo(0.6, 12);
  });

  it('stops on records of different lengths or with other marks', () => {
    expect(code(() => observers([1, 0], [1]))).toBe('sameIntervals');
    expect(code(() => readRecord('1 2', 'first'))).toBe('record');
  });
});

describe('single-case data', () => {
  it('gives PND 60% and NAP 0.875', () => {
    // Highest baseline point is 5; 6, 7, 8 are above it: 3 of 5.
    // B over A pairs: 6 beats 4; 5 beats 3 and ties 1; 7 and 8 beat 4 each; 4 beats 1 and ties 2: 17.5 of 20.
    const [a, b] = readPhases('A | 3, 4, 5, 4\nB | 6, 5, 7, 8, 4');
    const r = overlap(a.values, b.values, true);
    expect(r.pnd).toBeCloseTo(0.6, 9);
    expect(r.nap).toBeCloseTo(0.875, 9);
    expect(r.tau).toBeCloseTo((16 - 1) / 20, 9);
    expect(b.sessions).toEqual([5, 6, 7, 8, 9]);
  });

  it('mirrors the overlap for a behavior meant to decrease', () => {
    const r = overlap([5, 6], [4, 6], false);
    expect(r.pnd).toBe(0.5);
    expect(r.nap).toBeCloseTo((2 + 0.5) / 4, 12);
  });

  it('gives level, trend, and the split-middle line of a phase', () => {
    const s = phaseSummary({ name: 'A', values: [2, 4, 6, 8], sessions: [1, 2, 3, 4] });
    expect(s.mean).toBe(5);
    expect(s.slope).toBeCloseTo(2, 12);
    // Halves (1, 2 | 2, 4) and (3, 4 | 6, 8): medians (1.5, 3) and (3.5, 7), slope 2.
    expect(s.splitSlope).toBeCloseTo(2, 12);
    expect(s.splitIntercept).toBeCloseTo(0, 12);
    expect(phaseSummary({ name: 'B', values: [3], sessions: [5] }).slope).toBeNaN();
  });

  it('needs 2 phases with values', () => {
    expect(code(() => readPhases('A | 1 2'))).toBe('fewPhases');
    expect(code(() => readPhases('A | 1 2\nB |'))).toBe('phaseLine');
    expect(code(() => readPhases('A | 1 x\nB | 2'))).toBe('badCell');
  });
});
