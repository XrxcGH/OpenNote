import { describe, expect, it } from 'vitest';
import { greenTheorem, lineIntegral, potentialDifference } from './curves';
import { divergenceCurl, gradient, jacobian } from './diff';
import { criticalPoints, lagrange } from './optimize';
import { FIRST, OPERATIONS, SAMPLES, run, type State } from './run';
import { divergenceTheorem, stokesTheorem, surfaceIntegral } from './surfaces';

type Out = { lines: readonly { key: string; vars?: Readonly<Record<string, string>> }[] };
const vars = (out: Out, key: string) => out.lines.find((l) => l.key === key)?.vars;
const keys = (out: Out) => out.lines.map((l) => l.key);
const num = (s: string) => Number(s.replace('−', '-'));
const GREEN = { rect: '0, 1, 0, 2', disk: '0, 0, 1', lower: 'x^2', upper: 'x', xRange: '0, 1' };

describe('the planned validation cases', () => {
  it('curl of (-y, x, 0) is (0, 0, 2)', () => {
    const out = divergenceCurl('-y, x, 0', 'cartesian', '');
    expect(vars(out, 'vcCurl')!.curl).toBe('(0, 0, 2)');
    expect(vars(out, 'vcDiv')!.div).toBe('0');
    expect(keys(out)).toContain('vcSolenoidal');
    expect(keys(out)).toContain('vcNotIrrotational');
  });
  it('div of (x^2, y^2, z^2) at (1, 1, 1) is 6', () => {
    const out = divergenceCurl('x^2, y^2, z^2', 'cartesian', '1, 1, 1');
    expect(num(vars(out, 'vcDivAt')!.div)).toBe(6);
    expect(keys(out)).toContain('vcIrrotational');
  });
  it("Green's theorem for x dy around the unit circle gives the area, pi, on both sides", () => {
    const out = greenTheorem('0, x', 'disk', GREEN);
    const v = vars(out, 'vcGreen')!;
    expect(num(v.boundary)).toBeCloseTo(Math.PI, 10);
    expect(num(v.area)).toBeCloseTo(Math.PI, 10);
  });
  it('the line integral of (y, x) from (0,0) to (1,2) is 2 along any path', () => {
    const straight = lineIntegral('vector', 'y, x', 't, 2*t', '0, 1');
    expect(num(vars(straight, 'vcLineValue')!.value)).toBeCloseTo(2, 10);
    const curved = lineIntegral('vector', 'y, x', 't, 2*t^2', '0, 1');
    expect(num(vars(curved, 'vcLineValue')!.value)).toBeCloseTo(2, 10);
    expect(num(vars(straight, 'vcConservative')!.alt)).toBeCloseTo(2, 10);
    expect(num(vars(potentialDifference('y, x', '0, 0', '1, 2'), 'vcPotentialDifference')!.value)).toBeCloseTo(2, 10);
  });
  it('the flux of (x, y, z) through the unit sphere is 4 pi, by the surface and by the divergence theorem', () => {
    const flux = surfaceIntegral('flux', 'x, y, z', 'sin(u)*cos(v), sin(u)*sin(v), cos(u)', '0, pi, 0, 2*pi');
    expect(num(vars(flux, 'vcFlux')!.value)).toBeCloseTo(4 * Math.PI, 8);
    const theorem = divergenceTheorem('x, y, z', 'sphere', '1', '');
    const v = vars(theorem, 'vcDivergenceTheorem')!;
    expect(num(v.flux)).toBeCloseTo(4 * Math.PI, 8);
    expect(num(v.volume)).toBeCloseTo(4 * Math.PI, 8);
  });
  it('f = x^3 - 3x + y^2 has a minimum at (1, 0) and a saddle at (-1, 0)', () => {
    const out = criticalPoints('x^3 - 3*x + y^2', '-4, 4, -4, 4');
    const rows = out.tables[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(0, 2).map(num)).toEqual([-1, 0]);
    expect(rows[0][5]).toBe('@saddle');
    expect(rows[1].slice(0, 2).map(num)).toEqual([1, 0]);
    expect(rows[1][5]).toBe('@min');
  });
  it('maximizing xy on x + y = 10 gives 25 at (5, 5)', () => {
    const out = lagrange('x*y', 'x + y', '10', '-10, 10, -10, 10');
    const rows = out.tables[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 2).map(num)).toEqual([expect.closeTo(5, 8), expect.closeTo(5, 8)]);
    expect(num(rows[0][2])).toBeCloseTo(5, 8);
    expect(num(rows[0][3])).toBeCloseTo(25, 8);
  });
});

describe('gradient, tangent plane, and directional derivative', () => {
  it('computes the gradient of x^2 y + sin(y z) at (1, 1, 1)', () => {
    const out = gradient('x^2*y + sin(y*z)', '1, 1, 1', '1, 2, 2');
    const at = vars(out, 'vcGradientAt')!;
    expect(at.grad).toBe(
      `(2, ${(1 + Math.cos(1)).toPrecision(8).replace(/0+$/, '')}, ${Math.cos(1).toPrecision(8).replace(/0+$/, '')})`,
    );
    const directional = num(vars(out, 'vcDirectional')!.value);
    expect(directional).toBeCloseTo((2 * 1 + 2 * (1 + Math.cos(1)) + 2 * Math.cos(1)) / 3, 7);
    expect(num(vars(out, 'vcSteepest')!.rate)).toBeCloseTo(Math.hypot(2, 1 + Math.cos(1), Math.cos(1)), 7);
  });
  it('the tangent plane to z = x^2 + y^2 at (1, 2) is z = 5 + 2(x-1) + 4(y-2)', () => {
    const out = gradient('x^2 + y^2', '1, 2', '');
    expect(vars(out, 'vcPlane')!.plane).toBe('z = 5 + 2*(x - 1) + 4*(y - 2)');
  });
  it('rejects a point of the wrong length, a zero direction, and a constant', () => {
    expect(() => gradient('x*y', '1, 2, 3', '')).toThrow();
    expect(() => gradient('x*y', '1, 2', '0, 0')).toThrow();
    expect(() => gradient('5', '1', '')).toThrow();
    expect(() => gradient('x + w', '1', '')).toThrow();
  });
});

describe('divergence and curl in other coordinates', () => {
  it('cylindrical: F = r in the r direction has divergence 2', () => {
    const out = divergenceCurl('r, 0, 0', 'cylindrical', '2, 0.3, 1');
    expect(num(vars(out, 'vcDivAt')!.div)).toBeCloseTo(2, 10);
  });
  it('cylindrical: the swirl F = r in the theta direction has curl 2 along z', () => {
    const out = divergenceCurl('0, r, 0', 'cylindrical', '2, 0.3, 1');
    expect(vars(out, 'vcCurlAt')!.curl).toBe('(0, 0, 2)');
  });
  it('spherical: F = r in the r direction has divergence 3, and the inverse-square field has none', () => {
    const a = divergenceCurl('r, 0, 0', 'spherical', '2, 1, 0.5');
    expect(num(vars(a, 'vcDivAt')!.div)).toBeCloseTo(3, 10);
    const b = divergenceCurl('1/r^2, 0, 0', 'spherical', '2, 1, 0.5');
    expect(Math.abs(num(vars(b, 'vcDivAt')!.div))).toBeLessThan(1e-10);
  });
  it('a planar field has a scalar curl', () => {
    const out = divergenceCurl('-y, x', 'cartesian', '1, 1, 0');
    expect(keys(out)).toContain('vcCurl2');
    expect(vars(out, 'vcCurl2')!.curl).toBe('2');
  });
  it('rejects the wrong number of components and unknown names', () => {
    expect(() => divergenceCurl('x, y, z, w', 'cartesian', '')).toThrow();
    expect(() => divergenceCurl('x, y', 'spherical', '')).toThrow();
    expect(() => divergenceCurl('x, q, z', 'cartesian', '')).toThrow();
  });
});

describe('the Jacobian', () => {
  it('polar coordinates have determinant r', () => {
    const out = jacobian('r*cos(theta), r*sin(theta)', 'r, theta', '2, 0.5');
    expect(num(vars(out, 'vcJacobianAt')!.det)).toBeCloseTo(2, 12);
  });
  it('spherical coordinates have determinant rho^2 sin(phi)', () => {
    const out = jacobian(
      'rho*sin(phi)*cos(theta), rho*sin(phi)*sin(theta), rho*cos(phi)',
      'rho, phi, theta',
      '2, 1, 0.5',
    );
    expect(num(vars(out, 'vcJacobianAt')!.det)).toBeCloseTo(4 * Math.sin(1), 6);
  });
  it('a linear map has the determinant of its matrix', () => {
    const out = jacobian('2*u + v, u - 3*v', 'u, v', '0, 0');
    expect(vars(out, 'vcJacobian')!.det).toBe('-7');
  });
});

describe('integrals over curves and regions', () => {
  it('the scalar line integral of x y over the quarter circle is 1/2', () => {
    const out = lineIntegral('scalar', 'x*y', 'cos(t), sin(t)', '0, pi/2');
    expect(num(vars(out, 'vcLineScalarValue')!.value)).toBeCloseTo(0.5, 10);
  });
  it('the circulation of (-y, x) around the unit circle is 2 pi and the field is not conservative', () => {
    const out = lineIntegral('vector', '-y, x', 'cos(t), sin(t)', '0, 2*pi');
    expect(num(vars(out, 'vcLineValue')!.value)).toBeCloseTo(2 * Math.PI, 10);
    expect(keys(out)).toContain('vcNotConservative');
    expect(keys(out)).toContain('vcClosedCurve');
  });
  it('a conservative field has zero circulation around a closed curve', () => {
    const out = lineIntegral('vector', '2*x*y, x^2', 'cos(t), sin(t)', '0, 2*pi');
    expect(Math.abs(num(vars(out, 'vcLineValue')!.value))).toBeLessThan(1e-9);
    expect(keys(out)).toContain('vcConservative');
  });
  it('works in space', () => {
    // F = (y, x, 1) along a helix is a gradient of x y + z: the integral is z(end) - z(start) + x y difference
    const out = lineIntegral('vector', 'y, x, 1', 'cos(t), sin(t), t', '0, 2*pi');
    expect(num(vars(out, 'vcLineValue')!.value)).toBeCloseTo(2 * Math.PI, 9);
  });
  it('a field that is not conservative has no potential', () => {
    expect(() => potentialDifference('-y, x', '0, 0', '1, 2')).toThrow();
  });
  it('Green on a rectangle and between two curves', () => {
    const rect = greenTheorem('-y, x', 'rect', GREEN);
    expect(num(vars(rect, 'vcGreen')!.boundary)).toBeCloseTo(4, 10);
    expect(num(vars(rect, 'vcGreen')!.area)).toBeCloseTo(4, 10);
    const typeI = greenTheorem('0, x', 'typeI', GREEN);
    expect(num(vars(typeI, 'vcGreen')!.boundary)).toBeCloseTo(1 / 6, 9);
    expect(num(vars(typeI, 'vcGreen')!.area)).toBeCloseTo(1 / 6, 9);
  });
  it('rejects an empty interval and a region with the curves crossed', () => {
    expect(() => lineIntegral('vector', 'y, x', 't, t', '1, 1')).toThrow();
    expect(() => greenTheorem('0, x', 'typeI', { ...GREEN, lower: 'x', upper: 'x^2' })).toThrow();
    expect(() => greenTheorem('0, x', 'rect', { ...GREEN, rect: '1, 0, 0, 1' })).toThrow();
  });
});

describe('integrals over surfaces', () => {
  const sphere = 'sin(u)*cos(v), sin(u)*sin(v), cos(u)';
  it('the area of the unit sphere is 4 pi and the integral of z^2 is 4 pi / 3', () => {
    expect(num(vars(surfaceIntegral('area', '', sphere, '0, pi, 0, 2*pi'), 'vcArea')!.value)).toBeCloseTo(
      4 * Math.PI,
      8,
    );
    expect(num(vars(surfaceIntegral('scalar', 'z^2', sphere, '0, pi, 0, 2*pi'), 'vcSurfaceScalar')!.value)).toBeCloseTo(
      (4 * Math.PI) / 3,
      8,
    );
  });
  it('the divergence theorem on a box', () => {
    const out = divergenceTheorem('x^2, y*z, x*y', 'box', '', '0, 1, 0, 2, 0, 3');
    const v = vars(out, 'vcDivergenceTheorem')!;
    expect(num(v.flux)).toBeCloseTo(num(v.volume), 9);
    // div = 2x + z; integral over the box = 2 * (1/2) * 2 * 3 + 1 * 2 * (9/2) = 6 + 9
    expect(num(v.volume)).toBeCloseTo(15, 9);
  });
  it("Stokes' theorem on a hemisphere: both sides are 2 pi", () => {
    const out = stokesTheorem('-y, x, 0', sphere, '0, pi/2, 0, 2*pi');
    const v = vars(out, 'vcStokes')!;
    expect(num(v.circulation)).toBeCloseTo(2 * Math.PI, 8);
    expect(num(v.flux)).toBeCloseTo(2 * Math.PI, 8);
  });
  it('rejects a surface with the wrong number of components or ranges', () => {
    expect(() => surfaceIntegral('area', '', 'u, v', '0, 1, 0, 1')).toThrow();
    expect(() => surfaceIntegral('area', '', 'u, v, u*v', '0, 1, 0')).toThrow();
    expect(() => surfaceIntegral('area', '', 'u, v, u*v', '1, 0, 0, 1')).toThrow();
  });
});

describe('optimization edge cases', () => {
  it('finds a maximum and a minimum on a circle', () => {
    const out = lagrange('x + 2*y', 'x^2 + y^2', '5', '-4, 4, -4, 4');
    const f = out.tables[0].rows.map((r) => num(r[3]));
    expect(Math.max(...f)).toBeCloseTo(5, 7);
    expect(Math.min(...f)).toBeCloseTo(-5, 7);
    expect(out.tables[0].rows.map((r) => r[4]).sort()).toEqual(['@max', '@min']);
  });
  it('works with three variables', () => {
    const out = lagrange('x + y + z', 'x^2 + y^2 + z^2', '3', '-3, 3, -3, 3, -3, 3');
    const f = out.tables[0].rows.map((r) => num(r[4]));
    expect(Math.max(...f)).toBeCloseTo(3, 6);
    expect(Math.min(...f)).toBeCloseTo(-3, 6);
  });
  it('reports a flat function and an unreachable constraint', () => {
    expect(criticalPoints('x*y + 5', '-2, 2, -2, 2').tables[0].rows.map((r) => r[5])).toEqual(['@saddle']);
    expect(keys(lagrange('x*y', 'x^2 + y^2', '-1', '-3, 3, -3, 3'))).toEqual(['vcLagrangeNone']);
    expect(keys(criticalPoints('x + y', '-2, 2, -2, 2'))).toEqual(['vcCriticalNone']);
  });
  it('classifies a degenerate critical point as inconclusive', () => {
    expect(criticalPoints('x^4 + y^4', '-2, 2, -2, 2').tables[0].rows[0][5]).toBe('@unknown');
  });
  it('rejects a bad window and a third variable', () => {
    expect(() => criticalPoints('x^2 + y^2', '3, -3, -3, 3')).toThrow();
    expect(() => criticalPoints('x^2 + z', '-3, 3, -3, 3')).toThrow();
  });
});

describe('every operation runs on its sample', () => {
  for (const op of OPERATIONS) {
    it(`${op} works on its sample`, () => {
      const out = run({ ...FIRST, ...SAMPLES[op], op } as State);
      expect(out.lines.length).toBeGreaterThan(0);
      expect(out.steps.length).toBeGreaterThan(0);
    });
  }
});

describe('fields with a hole, degenerate points and unbounded constraints', () => {
  const VORTEX = '-y/(x^2+y^2), x/(x^2+y^2)';
  it('the vortex around the unit circle is 2 pi and is not called conservative', () => {
    const out = lineIntegral('vector', VORTEX, 'cos(t), sin(t)', '0, 2*pi');
    expect(num(vars(out, 'vcLineValue')!.value)).toBeCloseTo(2 * Math.PI, 8);
    expect(keys(out)).toContain('vcHole');
    expect(keys(out)).not.toContain('vcConservative');
  });
  it('the vortex over the upper half circle is pi, not the 0 of a conservative field', () => {
    const out = lineIntegral('vector', VORTEX, 'cos(t), sin(t)', '0, pi');
    expect(num(vars(out, 'vcLineValue')!.value)).toBeCloseTo(Math.PI, 8);
    expect(keys(out)).not.toContain('vcConservative');
  });
  it('a conservative field away from its pole still says so', () => {
    const out = lineIntegral('vector', '1/x, 1/y', '1+t, 1+2*t', '0, 1');
    expect(num(vars(out, 'vcLineValue')!.value)).toBeCloseTo(Math.log(2) + Math.log(3), 8);
    expect(keys(out)).toContain('vcConservative');
  });
  it('the potential of (1/x, 1/y) is built from A: ln 6 from (1,1) to (2,3), and its gradient matches', () => {
    const out = potentialDifference('1/x, 1/y', '1, 1', '2, 3');
    expect(num(vars(out, 'vcPotentialDifference')!.value)).toBeCloseTo(Math.log(6), 9);
    expect(num(vars(out, 'vcPotentialAtB')!.err)).toBeLessThan(1e-6);
    expect(keys(out)).not.toContain('vcHole');
  });
  it('the vortex potential between (1,0) and (0,1) is pi/2 with a warning about the hole at the origin', () => {
    const out = potentialDifference(VORTEX, '1, 0', '0, 1');
    expect(num(vars(out, 'vcPotentialDifference')!.value)).toBeCloseTo(Math.PI / 2, 8);
    expect(keys(out)).toContain('vcHole');
    expect(() => potentialDifference(VORTEX, '1, 0', '-1, 0')).toThrow();
  });
  it("Green's theorem on the vortex over the unit disk explains why the sides differ", () => {
    const out = greenTheorem(VORTEX, 'disk', GREEN);
    expect(num(vars(out, 'vcGreen')!.boundary)).toBeCloseTo(2 * Math.PI, 8);
    expect(keys(out)).toContain('vcGreenSingular');
    expect(keys(out)).toContain('vcGreenDiffer');
    expect(keys(greenTheorem('0, x', 'disk', GREEN))).toEqual(['vcGreen']);
  });
  it('(0, 1/r, 0) in cylindrical coordinates and the Cartesian vortex have zero divergence and zero curl', () => {
    const cyl = divergenceCurl('0, 1/r, 0', 'cylindrical', '');
    expect(keys(cyl)).toContain('vcSolenoidal');
    expect(keys(cyl)).toContain('vcIrrotational');
    const cart = divergenceCurl('-y/(x^2+y^2), x/(x^2+y^2), 0', 'cartesian', '');
    expect(keys(cart)).toContain('vcSolenoidal');
    expect(keys(cart)).toContain('vcIrrotational');
    expect(keys(divergenceCurl('0, r, 0', 'cylindrical', ''))).toContain('vcNotIrrotational');
  });
  it('x^4 + y^4 has one critical point, at the origin, and x^3 + y^3 has it exactly at (0, 0)', () => {
    const quartic = criticalPoints('x^4 + y^4', '-3, 3, -3, 3').tables[0].rows;
    expect(quartic).toHaveLength(1);
    expect(quartic[0].slice(0, 2).map(num)).toEqual([0, 0]);
    const cubic = criticalPoints('x^3 + y^3', '-3, 3, -3, 3').tables[0].rows;
    expect(cubic).toHaveLength(1);
    expect(cubic[0].slice(0, 2).map(num)).toEqual([0, 0]);
  });
  it('a function of three variables is refused with a clear code', () => {
    expect(() => criticalPoints('x^2 + y^2 + z^2', '-2, 2, -2, 2')).toThrow(/vcTwoVariables/);
  });
  it('xyz on x + y + z = 3 is unbounded: (1,1,1) is a local maximum and no point is a global minimum', () => {
    const out = lagrange('x*y*z', 'x + y + z', '3', '-4, 4, -4, 4, -4, 4');
    const rows = out.tables[0].rows;
    expect(keys(out)).toContain('vcLagrangeUnbounded');
    expect(
      rows
        .find((r) =>
          r
            .slice(0, 3)
            .map(num)
            .every((v) => Math.abs(v - 1) < 1e-6),
        )!
        .at(-1),
    ).toBe('@max');
    expect(rows.some((r) => r.at(-1) === '@min')).toBe(false);
  });
  it('a bounded constraint (the sphere) still labels the global extrema', () => {
    const out = lagrange('x + y + z', 'x^2 + y^2 + z^2', '3', '-3, 3, -3, 3, -3, 3');
    expect(keys(out)).not.toContain('vcLagrangeUnbounded');
    expect(out.tables[0].rows.map((r) => r.at(-1))).toEqual(['@max', '@min']);
  });
});
