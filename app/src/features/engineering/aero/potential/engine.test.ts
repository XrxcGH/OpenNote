import { describe, expect, it } from 'vitest';
import { AeroError, brent } from '../common';
import { potentialFlow, type FlowElement } from './engine';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);
const cylinder = (U: number, a: number, gamma = 0): FlowElement[] => [
  { kind: 'uniform', strength: U, x: 0, y: 0 },
  { kind: 'doublet', strength: 2 * Math.PI * U * a * a, x: 0, y: 0 },
  ...(gamma ? [{ kind: 'vortex' as const, strength: gamma, x: 0, y: 0 }] : []),
];

describe('potential flow', () => {
  it('gives Cp = 1 - 4 sin^2 theta on a cylinder without circulation', () => {
    for (const deg of [0, 30, 60, 90, 135]) {
      const t = (deg * Math.PI) / 180;
      const r = potentialFlow({ elements: cylinder(1, 1), rho: 1.225, px: Math.cos(t), py: Math.sin(t) });
      close(r.Cp, 1 - 4 * Math.sin(t) ** 2, 1e-9);
    }
    const top = potentialFlow({ elements: cylinder(1, 1), rho: 1.225, px: 0, py: 1 });
    close(top.Cp, -3, 1e-9);
    const stag = top.stagnation;
    expect(stag.length).toBe(2);
    close(stag[0]!.x, -1, 1e-6);
    close(stag[1]!.x, 1, 1e-6);
  });

  it('gives the Kutta-Joukowski lift with the stagnation points meeting at the bottom', () => {
    const r = potentialFlow({ elements: cylinder(10, 1, 4 * Math.PI * 10), rho: 1.225, px: 0, py: 2 });
    expect(Math.abs(r.lift - 1539.38) / 1539.38).toBeLessThan(1e-5);
    close(r.lift, 1.225 * 10 * 40 * Math.PI, 1e-9);
    expect(r.stagnation.length).toBe(1);
    close(r.stagnation[0]!.x, 0, 1e-4);
    close(r.stagnation[0]!.y, -1, 1e-4);
  });

  it('gives the Rankine half-body stagnation point and far half-width', () => {
    const els: FlowElement[] = [
      { kind: 'uniform', strength: 1, x: 0, y: 0 },
      { kind: 'source', strength: 2 * Math.PI, x: 0, y: 0 },
    ];
    const r = potentialFlow({ elements: els, rho: 1, px: 2, py: 2 });
    expect(r.stagnation.length).toBe(1);
    close(r.stagnation[0]!.x, -1, 1e-9);
    close(r.stagnation[0]!.y, 0, 1e-9);
    // Independent: the dividing streamline psi = m/2 far downstream, psi = U y + (m/2pi) theta.
    const X = 1e7;
    const y = brent((h) => h + Math.atan2(h, X) - Math.PI, 0.1, 10).root;
    close(y, Math.PI, 1e-6);
    expect(r.streamlines.length).toBeGreaterThan(10);
  });

  it('rejects an empty flow and a probe on a singularity', () => {
    expect(() => potentialFlow({ elements: [], rho: 1, px: 0, py: 0 })).toThrow(AeroError);
    expect(() => potentialFlow({ elements: cylinder(1, 1), rho: 1, px: 0, py: 0 })).toThrow(AeroError);
    expect(() => potentialFlow({ elements: cylinder(1, 1), rho: 0, px: 2, py: 0 })).toThrow(AeroError);
  });

  it('leaves Cp undefined without a free stream', () => {
    const r = potentialFlow({ elements: [{ kind: 'vortex', strength: 1, x: 0, y: 0 }], rho: 1, px: 1, py: 0 });
    expect(Number.isNaN(r.Cp)).toBe(true);
    close(r.v, -1 / (2 * Math.PI), 1e-12);
  });
});

describe('Cp contours', () => {
  const win = { x0: -3, x1: 3, y0: -2, y1: 2 };
  // Where a contour segment crosses the line x = 0 (or y = 0), the y (or x) of the crossing.
  const crossings = (segments: readonly (readonly [number, number, number, number])[], axis: 'x' | 'y') =>
    segments.flatMap(([x1, y1, x2, y2]) => {
      const [a1, a2, b1, b2] = axis === 'x' ? [x1, x2, y1, y2] : [y1, y2, x1, x2];
      if (a1 === a2 || a1 * a2 > 0) return [];
      return [b1 + ((b2 - b1) * (0 - a1)) / (a2 - a1)];
    });

  it('places the cylinder contours where Cp = 1 - (1 +/- a^2/r^2)^2 says', () => {
    const r = potentialFlow({ elements: cylinder(10, 1), rho: 1.225, px: 0, py: 1.5, window: win });
    const level = (cp: number) => r.cpContours.find((c) => Math.abs(c.level - cp) < 1e-12)!;
    // Above the cylinder V = U(1 + a^2/y^2): Cp = -1 at y = 1/sqrt(sqrt(2) - 1) = 1.553774.
    const above = crossings(level(-1).segments, 'x').filter((y) => y > 1.05);
    expect(above.length).toBeGreaterThan(0);
    above.forEach((y) => close(y, 1 / Math.sqrt(Math.SQRT2 - 1), 0.01));
    // Upstream on the axis V = U(1 - a^2/x^2): Cp = 0.75 at x = -sqrt(2).
    const ahead = crossings(level(0.75).segments, 'y').filter((x) => x < -1.05);
    expect(ahead.length).toBeGreaterThan(0);
    ahead.forEach((x) => close(x, -Math.SQRT2, 0.01));
    expect(r.cpContours.map((c) => c.level)).toEqual(Array.from({ length: 17 }, (_, k) => -3 + 0.25 * k));
  });

  it('draws no Cp contours without a free stream', () => {
    const r = potentialFlow({ elements: [{ kind: 'vortex', strength: 1, x: 0, y: 0 }], rho: 1, px: 1, py: 0 });
    expect(r.cpContours).toEqual([]);
  });
});
