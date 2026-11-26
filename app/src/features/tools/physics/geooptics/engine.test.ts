// The geometric optics and Gaussian beams tool against its validation cases (first principles) and independent
// working: Newton's form of the lens equation, a ray traced by hand, matrix determinants, and beam identities.
import '../text';
import { describe, expect, it } from 'vitest';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import {
  beamThroughLens,
  brewsterAngle,
  cardinal,
  criticalAngle,
  fiber,
  gaussianBeam,
  imageThrough,
  lensmaker,
  refract,
  thinLens,
  traceSystem,
  transformQ,
} from './engine';
import { GEO_OPTICS } from './spec';

const R = 'kitPhysics.geooptics.r.';
const D2R = Math.PI / 180;
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const words = (out: Outcome) => (out.ok ? out.rows.filter((row) => row.word).map((row) => row.word) : []);

describe('geometric optics and Gaussian beams', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(GEO_OPTICS)).toEqual([]);
  });

  it('thin lens f 10 cm, object at 30 cm: image 15 cm, magnification -0.5', () => {
    const image = thinLens(0.1, 0.3);
    expect(Math.abs(image.si - 0.15)).toBeLessThan(1e-9);
    expect(Math.abs(image.m + 0.5)).toBeLessThan(1e-9);
    // Newton's form: x·x′ = f², with x and x' measured from the focal points.
    expect((0.3 - 0.1) * (image.si - 0.1)).toBeCloseTo(0.01, 15);
    const out = runMode(GEO_OPTICS, 'lens', {});
    expect(value(out, `${R}imageDistance`)).toBeCloseTo(0.15, 12);
    expect(value(out, `${R}magnification`)).toBeCloseTo(-0.5, 12);
    expect(value(out, `${R}imageHeight`)).toBeCloseTo(-0.005, 12);
    expect(words(out)).toContain('kitPhysics.geooptics.kind.real');
    expect(words(out)).toContain('kitPhysics.geooptics.kind.inverted');
  });

  it('a magnifier and a diverging lens give virtual upright images', () => {
    const magnifier = thinLens(0.1, 0.05);
    expect(magnifier.si).toBeCloseTo(-0.1, 12);
    expect(magnifier.m).toBeCloseTo(2, 12);
    expect(magnifier.real).toBe(false);
    const diverging = thinLens(-0.1, 0.3);
    expect(diverging.si).toBeCloseTo(-0.075, 12);
    expect(diverging.m).toBeCloseTo(0.25, 12);
  });
});

describe('mirrors and lens errors', () => {
  it('a concave mirror is a lens of focal length R / 2', () => {
    const out = runMode(GEO_OPTICS, 'lens', { element: 'mirror', R: '20', s: '30' });
    expect(value(out, `${R}imageDistance`)).toBeCloseTo(0.15, 12);
    expect(value(out, `${R}focal`)).toBeCloseTo(0.1, 12);
    const convex = runMode(GEO_OPTICS, 'lens', { element: 'mirror', R: '-20', s: '30' });
    expect(value(convex, `${R}imageDistance`)).toBeCloseTo(-0.075, 12);
  });

  it('says what is wrong with an object at the focus, a zero focal length, or a negative distance', () => {
    expect(problem(runMode(GEO_OPTICS, 'lens', { s: '10' }))).toBe('kitPhysics.geooptics.errors.atFocus');
    expect(problem(runMode(GEO_OPTICS, 'lens', { f: '0' }))).toBe('kitPhysics.geooptics.errors.zeroFocal');
    expect(problem(runMode(GEO_OPTICS, 'lens', { s: '-5' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(GEO_OPTICS, 'lens', { f: 'ten' }))).toBe('kitPhysics.errors.notNumber');
    expect(problem(runMode(GEO_OPTICS, 'lens', { element: 'mirror', R: '0' }))).toBe(
      'kitPhysics.geooptics.errors.zeroRadius',
    );
  });
});

describe('optical systems by ray-transfer matrices', () => {
  it('two lenses f 10 and 20 cm, 15 cm apart: the system matrix, EFL 13.333 cm and BFL -6.6667 cm', () => {
    const traced = traceSystem(
      [
        { kind: 'lens', f: 0.1 },
        { kind: 'gap', d: 0.15 },
        { kind: 'lens', f: 0.2 },
      ],
      1,
    );
    const [A, B, C, D] = traced.matrix;
    expect(Math.abs(A + 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(B - 0.15)).toBeLessThan(1e-6);
    expect(Math.abs(C + 7.5)).toBeLessThan(1e-6); // -0.075 per cm is -7.5 per meter
    expect(Math.abs(D - 0.25)).toBeLessThan(1e-6);
    expect(A * D - B * C).toBeCloseTo(1, 14);
    const focal = cardinal(traced.matrix);
    expect(focal).not.toBeNull();
    expect(Math.abs((focal?.efl ?? 0) - 0.4 / 3)).toBeLessThan(1e-8);
    expect(Math.abs((focal?.bfl ?? 0) + 0.2 / 3)).toBeLessThan(1e-8);
    // The two-lens formula: 1/f = 1/f1 + 1/f2 - d/(f1 f2), and BFL = f (f1 - d) / f1.
    const f = 1 / (1 / 0.1 + 1 / 0.2 - 0.15 / (0.1 * 0.2));
    expect(focal?.efl).toBeCloseTo(f, 14);
    expect(focal?.bfl).toBeCloseTo((f * (0.1 - 0.15)) / 0.1, 14);
    // The window reads the same list in centimeters.
    const out = runMode(GEO_OPTICS, 'system', {});
    expect(value(out, `${R}C`)).toBeCloseTo(-0.075, 12);
    expect(value(out, `${R}efl`)).toBeCloseTo(0.4 / 3, 12);
    expect(value(out, `${R}bfl`)).toBeCloseTo(-0.2 / 3, 12);
  });

  it('an object through a train agrees with lens after lens', () => {
    const traced = traceSystem(
      [
        { kind: 'lens', f: 0.1 },
        { kind: 'gap', d: 0.15 },
        { kind: 'lens', f: 0.2 },
      ],
      1,
    );
    const through = imageThrough(traced.matrix, 0.3);
    // Lens 1 images to 15 cm, right at lens 2, which leaves it there with m = 1.
    expect(through.si).toBeCloseTo(0, 12);
    expect(through.m).toBeCloseTo(-0.5, 12);
    const far = imageThrough(traced.matrix, 0.5);
    const first = thinLens(0.1, 0.5); // 12.5 cm after lens 1, 2.5 cm before lens 2
    const second = thinLens(0.2, 0.15 - first.si);
    expect(far.si).toBeCloseTo(second.si, 12);
    expect(far.m).toBeCloseTo(first.m * second.m, 12);
  });

  it('a glass ball has det M = n_in / n_out at each face and focuses as a ball lens', () => {
    const n = 1.5;
    const r = 0.01;
    const traced = traceSystem(
      [
        { kind: 'surface', n, R: r },
        { kind: 'gap', d: 2 * r },
        { kind: 'surface', n: 1, R: -r },
      ],
      1,
    );
    const [A, B, C, D] = traced.matrix;
    expect(A * D - B * C).toBeCloseTo(1, 14);
    // Ball lens: EFL = n D / (4 (n - 1)) with D the diameter.
    expect(cardinal(traced.matrix)?.efl).toBeCloseTo((n * 2 * r) / (4 * (n - 1)), 14);
    const half = traceSystem([{ kind: 'surface', n, R: r }], 1).matrix;
    expect(half[0] * half[3] - half[1] * half[2]).toBeCloseTo(1 / n, 14);
  });
});

describe('afocal systems and the lensmaker equation', () => {
  it('a telescope is afocal, and the window says so', () => {
    const out = runMode(GEO_OPTICS, 'system', { elements: 'lens 20\ngap 25\nlens 5' });
    expect(words(out)).toContain('kitPhysics.geooptics.kind.afocal');
    expect(value(out, `${R}A`)).toBeCloseTo(-0.25, 12);
    expect(problem(runMode(GEO_OPTICS, 'system', { elements: 'prism 3' }))).toBe('kitPhysics.geooptics.errors.element');
    expect(problem(runMode(GEO_OPTICS, 'system', { elements: 'gap -2' }))).toBe(
      'kitPhysics.geooptics.errors.negativeGap',
    );
    expect(problem(runMode(GEO_OPTICS, 'system', { elements: 'lens' }))).toBe('kitPhysics.geooptics.errors.element');
  });

  it('lensmaker n 1.5, R1 20 cm, R2 -20 cm: f = 20 cm', () => {
    expect(Math.abs(lensmaker(1.5, 0.2, -0.2).f - 0.2)).toBeLessThan(1e-9);
    expect(value(runMode(GEO_OPTICS, 'lensmaker', {}), `${R}focal`)).toBeCloseTo(0.2, 12);
    // Plano-convex: f = R / (n - 1); in water the relative index lowers the power.
    expect(lensmaker(1.5, 0.1, Infinity).f).toBeCloseTo(0.2, 14);
    expect(value(runMode(GEO_OPTICS, 'lensmaker', { nm: '1.333' }), `${R}focal`)).toBeCloseTo(
      0.1 / (1.5 / 1.333 - 1),
      12,
    );
    // A thick lens agrees with its own matrix.
    const thick = lensmaker(1.5, 0.2, -0.2, 0.01);
    const traced = traceSystem(
      [
        { kind: 'surface', n: 1.5, R: 0.2 },
        { kind: 'gap', d: 0.01 },
        { kind: 'surface', n: 1, R: -0.2 },
      ],
      1,
    );
    expect(cardinal(traced.matrix)?.efl).toBeCloseTo(thick.f, 14);
    expect(cardinal(traced.matrix)?.bfl).toBeCloseTo(thick.bfl, 14);
    expect(cardinal(traced.matrix)?.ffl).toBeCloseTo(thick.ffl, 14);
    expect(problem(runMode(GEO_OPTICS, 'lensmaker', { R1: '', R2: '' }))).toBe('kitPhysics.geooptics.errors.noPower');
    expect(problem(runMode(GEO_OPTICS, 'lensmaker', { nm: '1.5' }))).toBe('kitPhysics.geooptics.errors.sameIndex');
  });
});

describe('refraction and fibers', () => {
  it('refraction, the critical angle and total internal reflection', () => {
    expect(refract(1, 1.5, 30 * D2R)).toBeCloseTo(Math.asin(1 / 3), 15);
    expect(criticalAngle(1.5, 1)).toBeCloseTo(Math.asin(1 / 1.5), 15);
    expect(criticalAngle(1, 1.5)).toBeNull();
    expect(refract(1.5, 1, 45 * D2R)).toBeNull();
    expect(brewsterAngle(1, 1.5) / D2R).toBeCloseTo(56.3099325, 6);
    const out = runMode(GEO_OPTICS, 'refraction', { n1: '1.5', n2: '1', theta: '45' });
    expect(words(out)).toContain('kitPhysics.geooptics.kind.tir');
  });

  it('step-index fiber numerical aperture, acceptance and V number', () => {
    const out = fiber(1.4504, 1.4447, 1);
    expect(out.na).toBeCloseTo(Math.sqrt(1.4504 ** 2 - 1.4447 ** 2), 15);
    expect(out.acceptance).toBeCloseTo(Math.asin(out.na), 15);
    // The acceptance cone's edge meets the core wall at exactly the critical angle.
    expect(Math.sin(Math.PI / 2 - (refract(1, 1.4504, out.acceptance) ?? 0))).toBeCloseTo(1.4447 / 1.4504, 14);
    const run = runMode(GEO_OPTICS, 'fiber', {});
    expect(value(run, `${R}V`)).toBeCloseTo(((2 * Math.PI * 4.1e-6) / 1550e-9) * out.na, 10);
    expect(words(run)).toContain('kitPhysics.geooptics.kind.singleMode');
    expect(words(runMode(GEO_OPTICS, 'fiber', { core: '1.48', clad: '1.46' }))).toContain(
      'kitPhysics.geooptics.kind.multiMode',
    );
    expect(problem(runMode(GEO_OPTICS, 'fiber', { clad: '1.5' }))).toBe('kitPhysics.geooptics.errors.noGuide');
  });
});

describe('Gaussian beams', () => {
  it('HeNe 633 nm, w0 0.5 mm: zR 1.24076 m, w(2 m) 0.94846 mm, half-angle 0.80596 mrad', () => {
    const beam = gaussianBeam(633e-9, 0.5e-3, 2);
    expect(rel(beam.zR, 1.24076)).toBeLessThan(1e-5);
    expect(rel(beam.w, 0.94846e-3)).toBeLessThan(1e-5);
    // The plan's 0.80596 mrad is the full angle 2 lambda / (pi w0); the half-angle is half of it.
    expect(rel(2 * beam.theta, 0.80596e-3)).toBeLessThan(1e-5);
    expect(beam.theta).toBeCloseTo(633e-9 / (Math.PI * 0.5e-3), 15);
    // Far from the waist w approaches theta z; at z = zR it is w0 √2 and R = 2 zR.
    expect(gaussianBeam(633e-9, 0.5e-3, 1e4).w / 1e4).toBeCloseTo(beam.theta, 9);
    const atZR = gaussianBeam(633e-9, 0.5e-3, beam.zR);
    expect(atZR.w).toBeCloseTo(0.5e-3 * Math.SQRT2, 15);
    expect(atZR.R).toBeCloseTo(2 * beam.zR, 12);
    expect(gaussianBeam(633e-9, 0.5e-3, 0).R).toBe(Infinity);
    const out = runMode(GEO_OPTICS, 'beam', {});
    expect(value(out, `${R}width`)).toBeCloseTo(beam.w, 12);
    expect(problem(runMode(GEO_OPTICS, 'beam', { m2: '0.5' }))).toBe('kitPhysics.errors.range');
  });

  it('a beam through a lens: the q law agrees with the waist-imaging formula', () => {
    const lambda = 1064e-9;
    const w0 = 1e-3;
    const f = 0.1;
    const d1 = 0.5;
    const out = beamThroughLens(lambda, w0, d1, f);
    const zR = (Math.PI * w0 * w0) / lambda;
    // Self's formula: d2 = f + (d1 - f) f² / ((d1 - f)² + zR²), w0' = w0 f / √((d1 - f)² + zR²).
    const den = (d1 - f) ** 2 + zR * zR;
    expect(out.d2).toBeCloseTo(f + ((d1 - f) * f * f) / den, 14);
    expect(out.w02).toBeCloseTo((w0 * f) / Math.sqrt(den), 14);
    // A free gap only adds to Re q.
    expect(transformQ([1, 0.3, 0, 1], [0.2, 1.5])).toEqual([0.5, 1.5]);
  });
});
