// Projectile motion against textbook answers (Serway, Physics for Scientists and Engineers, chapter 4).
import { describe, expect, it } from 'vitest';
import { compileSpecial, sampleCurve } from '../grapher/curves';
import { readGraph } from '../graph/source';
import { flight, landingTime, positionAt, trajectoryGraph, validLaunch, type Launch } from './projectile';

const launch = (over: Partial<Launch> = {}): Launch => ({
  speed: 20,
  angle: 45,
  height: 0,
  gravity: 9.81,
  drag: 0,
  ...over,
});

describe('projectile motion', () => {
  it('matches the range formula on level ground', () => {
    // R = v² sin 2θ / g = 40.775 m, T = 2 v sin θ / g = 2.8832 s, H = v² sin² θ / 2g = 10.194 m.
    const result = flight(launch());
    expect(result.range).toBeCloseTo(400 / 9.81, 9);
    expect(result.time).toBeCloseTo((40 * Math.SQRT1_2) / 9.81, 12);
    expect(result.peakHeight).toBeCloseTo(200 / 2 / 9.81, 9);
    expect(result.impactSpeed).toBeCloseTo(20, 9);
  });

  it('matches a launch from a building', () => {
    // Serway, Example 4.5: thrown at 20 m/s, 30° up, from 45 m: lands after 4.22 s, 73.0 m out, at 35.9 m/s.
    const result = flight(launch({ angle: 30, height: 45, gravity: 9.8 }));
    expect(result.time).toBeCloseTo(4.22, 2);
    // The book rounds the time to 4.22 s first, so its 73.0 m and 35.9 m/s are within a tenth of the exact values.
    expect(Math.abs(result.range - 73.0)).toBeLessThan(0.1);
    expect(Math.abs(result.impactSpeed - 35.9)).toBeLessThan(0.1);
  });

  it('lands sooner and shorter with drag, and agrees with a step-by-step simulation', () => {
    const dragged = launch({ drag: 0.2 });
    const result = flight(dragged);
    expect(result.range).toBeLessThan(flight(launch()).range);
    expect(positionAt(dragged, landingTime(dragged)).y).toBeCloseTo(0, 9);
    // Runge-Kutta on x'' = −k x', y'' = −g − k y' must reach the same point at the landing time.
    let [x, y, vx, vy] = [0, 0, 20 * Math.SQRT1_2, 20 * Math.SQRT1_2];
    const steps = 4000;
    const h = result.time / steps;
    const f = (s: number[]) => [s[2], s[3], -0.2 * s[2], -9.81 - 0.2 * s[3]];
    for (let i = 0; i < steps; i++) {
      const s = [x, y, vx, vy];
      const k1 = f(s);
      const k2 = f(s.map((v, j) => v + (h / 2) * k1[j]));
      const k3 = f(s.map((v, j) => v + (h / 2) * k2[j]));
      const k4 = f(s.map((v, j) => v + h * k3[j]));
      [x, y, vx, vy] = s.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    expect(x).toBeCloseTo(result.range, 8);
    expect(y).toBeCloseTo(0, 8);
  });

  it('writes a graph block whose curve is the trajectory', () => {
    for (const drag of [0, 0.3]) {
      const text = trajectoryGraph(launch({ drag, height: 5 }));
      const graph = readGraph(text);
      expect(graph.t![1]).toBeCloseTo(flight(launch({ drag, height: 5 })).time, 4);
      const special = compileSpecial(graph.functions[0], {});
      if (!special.ok) throw new Error(special.error.message);
      const [run] = sampleCurve(special.kind, special.parts, graph.t!, graph.view!, {}, 50);
      const expected = positionAt(launch({ drag, height: 5 }), graph.t![1] / 2);
      expect(run[25].x).toBeCloseTo(expected.x, 3);
      expect(run[25].y).toBeCloseTo(expected.y, 3);
    }
  });

  it('refuses a launch that makes no sense', () => {
    expect(validLaunch(launch())).toBe(true);
    expect(validLaunch(launch({ gravity: 0 }))).toBe(false);
    expect(validLaunch(launch({ angle: 120 }))).toBe(false);
    expect(validLaunch(launch({ drag: -1 }))).toBe(false);
  });
});
