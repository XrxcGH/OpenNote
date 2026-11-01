import '../text';
import { describe, expect, it } from 'vitest';
import { c, formatC, readComplex, evaluateTree } from './cmath';
import { contourIntegral, evaluateValue, findPoles, improperIntegral, mapGrid, nthRoots, trigIntegral } from './engine';

const near = (a: { re: number; im: number }, re: number, im: number, tol = 1e-10) => {
  expect(Math.abs(a.re - re)).toBeLessThan(tol);
  expect(Math.abs(a.im - im)).toBeLessThan(tol);
};

describe('complex values', () => {
  it('(1 + i)^8 = 16', () => near(evaluateValue('(1+i)^8').value, 16, 0, 1e-12));
  it('the cube roots of -8 are 1 +/- i sqrt3 and -2', () => {
    const { roots } = nthRoots('-8', 3);
    near(roots[0], 1, Math.sqrt(3), 1e-12);
    near(roots[1], -2, 0, 1e-12);
    near(roots[2], 1, -Math.sqrt(3), 1e-12);
  });
  it('Log(-1) = i pi', () => near(evaluateValue('-1').principalLog!, 0, Math.PI, 1e-12));
  it('gives rectangular and polar forms', () => {
    const r = evaluateValue('3+4i');
    expect(r.modulus).toBeCloseTo(5, 12);
    expect(r.argument).toBeCloseTo(Math.atan2(4, 3), 12);
    expect(r.rect).toBe('3 + 4i');
  });
  it('handles e^(i pi), implicit products, and functions', () => {
    near(evaluateValue('e^(i*pi)').value, -1, 0, 1e-12);
    near(evaluateValue('2i(1-i)').value, 2, 2, 1e-12);
    near(evaluateValue('sqrt(-4)').value, 0, 2, 1e-12);
    near(evaluateValue('sin(i)').value, 0, Math.sinh(1), 1e-12);
  });
  it('reports impossible input', () => {
    expect(() => evaluateValue('1/0')).toThrow();
    expect(() => evaluateValue('1 +')).toThrow();
    expect(() => evaluateValue('z+1')).toThrow();
    expect(() => nthRoots('0', 3)).toThrow();
    expect(() => nthRoots('1', 0)).toThrow();
  });
  it('formats numbers without noise', () => {
    expect(formatC(c(1, 1e-17))).toBe('1');
    expect(formatC(c(0, -1))).toBe('−i');
  });
  it('reads exponents with a sign', () => {
    near(evaluateTree(readComplex('2^-2', []), {}), 0.25, 0);
  });
});

describe('poles and residues', () => {
  it('Res of 1/(z^2 + 1) at i is -i/2', () => {
    const { poles } = findPoles('1/(z^2+1)');
    expect(poles).toHaveLength(2);
    const atI = poles.find((p) => p.at.im > 0)!;
    near(atI.at, 0, 1, 1e-9);
    near(atI.residue, 0, -0.5, 1e-10);
    expect(atI.order).toBe(1);
  });
  it('finds a double pole and its residue', () => {
    const { poles } = findPoles('z/(z-1)^2');
    expect(poles).toHaveLength(1);
    expect(poles[0].order).toBe(2);
    near(poles[0].residue, 1, 0, 1e-7);
  });
  it('ignores a cancelled factor', () => {
    expect(findPoles('(z-1)/((z-1)(z+2))').poles).toHaveLength(1);
  });
  it('finds the pole of e^z/(z - 1) outside the rational family', () => {
    const { poles } = findPoles('e^z/(z-1)', [-2, 2, -2, 2]);
    expect(poles).toHaveLength(1);
    near(poles[0].residue, Math.E, 0, 1e-8);
  });
});

describe('contour integrals', () => {
  it('|z| = 2 of e^z/(z - 1) is 2 pi i e, by residues and by quadrature', () => {
    const r = contourIntegral('e^z/(z-1)', { kind: 'circle', center: c(0), radius: 2 });
    near(r.byResidues, 0, 2 * Math.PI * Math.E, 1e-8);
    near(r.numeric, 0, 2 * Math.PI * Math.E, 1e-8);
  });
  it('a square around the origin gives 2 pi i for 1/z', () => {
    const r = contourIntegral('1/z', { kind: 'polygon', points: [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)] });
    near(r.byResidues, 0, 2 * Math.PI, 1e-10);
    near(r.numeric, 0, 2 * Math.PI, 1e-9);
  });
  it('a pole outside the contour counts for nothing', () => {
    const r = contourIntegral('1/(z-5)', { kind: 'circle', center: c(0), radius: 1 });
    near(r.byResidues, 0, 0, 1e-12);
    near(r.numeric, 0, 0, 1e-9);
  });
  it('a clockwise square around the origin gives -2 pi i for 1/z, by both methods', () => {
    const r = contourIntegral('1/z', { kind: 'polygon', points: [c(-1, -1), c(-1, 1), c(1, 1), c(1, -1)] });
    near(r.byResidues, 0, -2 * Math.PI, 1e-10);
    near(r.numeric, 0, -2 * Math.PI, 1e-9);
    expect(r.disagree).toBe(false);
  });
  it('a figure eight winds +1 around one pole and -1 around the other', () => {
    // Lobes: the square [0,1]x[-1,1] counterclockwise, then [-1,0]x[-1,1] clockwise would share an edge; use two
    // separate loops joined at the origin: 1/(z-i/2) is wound once, 1/(z+i/2) wound minus once.
    const points = [c(0), c(1, 1), c(-1, 1), c(0), c(1, -1), c(-1, -1)];
    const r = contourIntegral('1/(z-0.5i)+2/(z+0.5i)', { kind: 'polygon', points });
    near(r.numeric, 0, 2 * Math.PI * (1 - 2), 1e-8);
    near(r.byResidues, 0, 2 * Math.PI * (1 - 2), 1e-8);
  });
  it('exp(1/z) around the unit circle is 2 pi i (an essential singularity), and the tool says the residues fail', () => {
    const r = contourIntegral('exp(1/z)', { kind: 'circle', center: c(0), radius: 1 });
    near(r.numeric, 0, 2 * Math.PI, 1e-8);
    near(r.value, 0, 2 * Math.PI, 1e-8);
    expect(r.disagree).toBe(true);
  });
  it('conj(z) around the unit circle is 2 pi i, not 0: it is not analytic', () => {
    const r = contourIntegral('conj(z)', { kind: 'circle', center: c(0), radius: 1 });
    near(r.value, 0, 2 * Math.PI, 1e-8);
    expect(r.disagree).toBe(true);
  });
  it('an analytic function raises no warning', () => {
    const r = contourIntegral('e^z/(z-1)', { kind: 'circle', center: c(0), radius: 2 });
    expect(r.disagree).toBe(false);
    near(r.value, 0, 2 * Math.PI * Math.E, 1e-8);
  });
  it('refuses a pole on the contour', () => {
    expect(() => contourIntegral('1/(z-1)', { kind: 'circle', center: c(0), radius: 1 })).toThrow();
  });
});

describe('real integrals by residues', () => {
  it('the integral of 1/(1 + x^2) over the real line is pi', () => {
    const r = improperIntegral('1/(1+x^2)');
    expect(Math.abs(r.value - Math.PI)).toBeLessThan(1e-10);
    expect(Math.abs(r.numeric - Math.PI)).toBeLessThan(1e-9);
  });
  it('1/(x^2+1)^2 is pi/2 (a double pole)', () => {
    expect(Math.abs(improperIntegral('1/(x^2+1)^2').value - Math.PI / 2)).toBeLessThan(1e-9);
  });
  it('explains why it cannot go on', () => {
    expect(() => improperIntegral('x/(1+x^2)')).toThrow();
    expect(() => improperIntegral('1/(x^2-1)')).toThrow();
    expect(() => improperIntegral('sin(x)/x')).toThrow();
  });
  it('the integral of 1/(2 + cos t) over 0..2pi is 2 pi/sqrt3', () => {
    const r = trigIntegral('1/(2+cos(t))');
    expect(Math.abs(r.value - (2 * Math.PI) / Math.sqrt(3))).toBeLessThan(1e-9);
    expect(Math.abs(r.numeric - 3.627599)).toBeLessThan(1e-6);
  });
  it('refuses a form that is not periodic in t', () => {
    expect(() => trigIntegral('t+cos(t)')).toThrow();
  });
});

describe('conformal maps', () => {
  it('z^2 sends the imaginary axis to the negative real axis', () => {
    const { lines } = mapGrid('square', -1, 1, -1, 1, 3);
    const axis = lines[1];
    expect(axis.every(([x, y]) => x <= 1e-12 && Math.abs(y) < 1e-12)).toBe(true);
  });
  it('rejects an empty region', () => {
    expect(() => mapGrid('exp', 1, 1, 0, 1)).toThrow();
  });
});
