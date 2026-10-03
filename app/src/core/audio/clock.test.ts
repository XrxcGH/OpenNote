// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HostClock } from './clock';
import { advance, fraction, QUIET, toDb } from './meter';

describe('HostClock', () => {
  it('learns the offset from the reading with the shortest round trip', () => {
    let local = 0;
    const clock = new HostClock(() => local);
    // The host clock reads 5,000,000,000 ns when the local clock reads 1,000 ms, so the offset is 4,000,000,000 ns.
    clock.observe({ captureNs: 5_000_000_000 + 40_000_000, unixMs: 0 }, 960, 1_040); // 80 ms round trip, host at 1,040
    clock.observe({ captureNs: 5_000_000_000, unixMs: 0 }, 998, 1_002); // 4 ms round trip, host at 1,000
    local = 2_000;
    expect(clock.nowNs()).toBe(6_000_000_000);
    expect(clock.uncertaintyMs).toBe(2);
  });

  it('calibrates by reading the host a few times', async () => {
    let local = 100;
    const clock = new HostClock(() => local);
    const reads: number[] = [];
    await clock.calibrate(async () => {
      local += 3;
      reads.push(local);
      return { captureNs: (local + 1) * 1_000_000 + 7_000_000_000, unixMs: 0 };
    }, 4);
    expect(reads).toHaveLength(4);
    expect(clock.isCalibrated).toBe(true);
    expect(Math.abs(clock.nowNs() - (local * 1_000_000 + 7_000_000_000 + 2_500_000))).toBeLessThan(3_000_000);
  });

  it('refuses to stamp before it has a reading', () => {
    expect(() => new HostClock(() => 0).nowNs()).toThrow('has not been read');
    expect(new HostClock(() => 0).uncertaintyMs).toBe(Infinity);
  });

  it('follows a drift as newer readings arrive', () => {
    let local = 0;
    const clock = new HostClock(() => local);
    for (let step = 0; step < 100; step += 1) {
      local = step * 1_000;
      // The host clock gains 1 ms every 100 s, 10 ppm.
      const host = local * 1_000_000 + step * 10_000;
      clock.observe({ captureNs: host + 1_000_000, unixMs: 0 }, local - 1, local + 1);
    }
    const expected = local * 1_000_000 + 99 * 10_000 + 1_000_000;
    expect(Math.abs(clock.nowNs() - expected)).toBeLessThan(2_000_000);
  });
});

describe('level meters', () => {
  it('converts levels to decibels with a floor', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(toDb(0)).toBe(-60);
    expect(toDb(1e-9)).toBe(-60);
    expect(fraction(0)).toBe(1);
    expect(fraction(-30)).toBe(0.5);
    expect(fraction(-90)).toBe(0);
  });

  const level = (peak: number, clipped = false) => ({ peak, rms: peak / 2, clipped, silentMs: 0, idleMs: 0 });

  it('rises at once and falls slowly', () => {
    const loud = advance(QUIET, level(0.5), 100);
    expect(loud.barDb).toBeCloseTo(-6.02, 1);
    const later = advance(loud, level(0), 500);
    // 24 dB a second for half a second.
    expect(later.barDb).toBeCloseTo(-6.02 - 12, 1);
  });

  it('holds the peak mark for a moment, and then lets it fall to the bar', () => {
    let state = advance(QUIET, level(0.5), 100);
    state = advance(state, level(0), 500);
    expect(state.holdDb).toBeCloseTo(-6.02, 1);
    state = advance(state, level(0), 1_000);
    expect(state.holdDb).toBe(state.barDb);
  });

  it('keeps the clip light on until a screen clears it', () => {
    let state = advance(QUIET, level(1, true), 100);
    state = advance(state, level(0.1), 100);
    expect(state.clipped).toBe(true);
    expect(advance(QUIET, undefined, 100).clipped).toBe(false);
  });
});
