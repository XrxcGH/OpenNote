// The interference, diffraction, and polarization tool against its validation cases (first principles) and
// independent working: other forms of the same laws, limits, and conservation.
import { describe, expect, it } from 'vitest';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import {
  besselJ1,
  brewster,
  describe as polarization,
  doubleSlit,
  filmFlips,
  filmThicknesses,
  filmWavelengths,
  fresnel,
  grating,
  malus,
  singleSlit,
  slitIntensity,
} from './engine';
import { WAVE_OPTICS } from './spec';

const R = 'kitPhysics.waveoptics.r.';
const D2R = Math.PI / 180;
const sig = (got: number, want: number, digits = 5) => expect(Number(got.toPrecision(digits))).toBe(want);
const word = (out: Outcome) => (out.ok ? out.rows.find((row) => row.word)?.word : null);
const jones = (text: Record<string, string>) => runMode(WAVE_OPTICS, 'jones', text);

describe('interference, diffraction, and polarization', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(WAVE_OPTICS)).toEqual([]);
  });

  it('double slit d 0.1 mm, 600 nm, L 1 m: fringe spacing 6.000 mm', () => {
    const out = doubleSlit(600e-9, 1e-4, 1, 3);
    expect(Math.abs(out.spacing - 6e-3)).toBeLessThan(1e-12);
    // The exact first fringe sits at L tan(asin(0.006)), just past 6 mm.
    expect(out.fringes[1].y).toBeCloseTo(Math.tan(Math.asin(0.006)), 15);
    expect(value(runMode(WAVE_OPTICS, 'double', {}), `${R}spacing`)).toBeCloseTo(6e-3, 12);
    // Bright at the fringe, dark halfway, and the single-slit envelope's zero removes the fringe at d / a.
    expect(slitIntensity(600e-9, 1e-4, 0, Math.asin(0.006))).toBeCloseTo(1, 12);
    expect(slitIntensity(600e-9, 1e-4, 0, Math.asin(0.003))).toBeCloseTo(0, 12);
    expect(slitIntensity(600e-9, 1e-4, 2.5e-5, Math.asin(4 * 0.006))).toBeCloseTo(0, 12);
  });

  it('single slit 0.05 mm, 600 nm, 1 m: first minimum at 12.000 mm', () => {
    const out = singleSlit(600e-9, 5e-5, 1);
    expect(Math.abs(out.y - 0.012)).toBeLessThan(1e-6);
    expect(out.small).toBeCloseTo(0.012, 15);
    expect(out.width).toBeCloseTo(2 * out.y, 15);
    expect(slitIntensity(600e-9, 0, 5e-5, out.theta)).toBeCloseTo(0, 12);
  });

  it('grating 600 lines/mm at 500 nm: first order at 17.458 degrees', () => {
    const orders = grating(500e-9, 1e-3 / 600);
    expect(Math.abs(orders[0].theta / D2R - 17.458) / 17.458).toBeLessThan(1e-4);
    expect(orders[0].theta).toBeCloseTo(Math.asin(0.3), 14);
    expect(orders.map((o) => o.m)).toEqual([1, 2, 3]);
    const out = runMode(WAVE_OPTICS, 'grating', { N: '6000' });
    expect(value(out, `${R}resolvable`, 'Δλ₁')).toBeCloseTo(500e-9 / 6000, 18);
  });

  it('grating resolving power grows with the order: 600 lines/mm, N 5000, m 2 gives R = 10000', () => {
    const out = runMode(WAVE_OPTICS, 'grating', { N: '5000' });
    expect(value(out, `${R}resolving`, 'R₁')).toBe(5000);
    expect(value(out, `${R}resolving`, 'R₂')).toBe(10000);
    expect(value(out, `${R}resolving`, 'R₃')).toBe(15000);
    // 500 nm / 10000 = 0.05 nm.
    expect(value(out, `${R}resolvable`, 'Δλ₂')).toBeCloseTo(0.05e-9, 18);
  });

  it('soap film n 1.33 in air at 550 nm: thinnest bright reflection 103.38 nm', () => {
    const flips = filmFlips(1, 1.33, 1);
    expect(flips).toBe(1);
    const t = filmThicknesses(550e-9, 1.33, flips, 3);
    expect(Math.abs(t.bright[0] - 103.38e-9) / 103.38e-9).toBeLessThan(1e-4);
    expect(t.bright[0]).toBeCloseTo(550e-9 / (4 * 1.33), 18);
    // A coating between air and glass flips twice, so a quarter wave is dark (the antireflection case).
    const coat = filmThicknesses(550e-9, 1.38, filmFlips(1, 1.38, 1.52), 1);
    expect(coat.dark[0]).toBeCloseTo(550e-9 / (4 * 1.38), 18);
    // A 500 nm film of n 1.33: 2 n t = 1330 nm, bright at 1330 / (m + ½) and dark at 1330 / m.
    const w = filmWavelengths(500e-9, 1.33, 1, 380e-9, 750e-9);
    expect(w.bright.map((x) => Math.round(x * 1e10) / 10)).toEqual([532, 380]);
    expect(w.dark.map((x) => Math.round(x * 1e10) / 10)).toEqual([665, 443.3]);
    const shown = runMode(WAVE_OPTICS, 'film', {});
    sig(value(shown, `${R}bright`, 't₁') * 1e9, 103.38);
  });

  it('n 1.5 at 45 degrees: Rs 0.092013, Rp 0.0084665, Brewster 56.310 degrees', () => {
    const f = fresnel(1, 1.5, 45 * D2R);
    expect(Math.abs(f.Rs - 0.092013)).toBeLessThan(1e-5);
    expect(Math.abs(f.Rp - 0.0084665)).toBeLessThan(1e-5);
    sig(brewster(1, 1.5) / D2R, 56.31);
    // The same from the sine and tangent forms: rs = −sin(i − t)/sin(i + t), rp = tan(i − t)/tan(i + t).
    const i = 45 * D2R;
    const t = Math.asin(Math.sin(i) / 1.5);
    expect(f.rs).toBeCloseTo(-Math.sin(i - t) / Math.sin(i + t), 14);
    expect(f.rp).toBeCloseTo(Math.tan(i - t) / Math.tan(i + t), 14);
    // At normal incidence both are ((n − 1)/(n + 1))², and p vanishes at Brewster's angle.
    expect(fresnel(1, 1.5, 0).Rs).toBeCloseTo(0.04, 14);
    expect(fresnel(1, 1.5, brewster(1, 1.5)).Rp).toBeCloseTo(0, 14);
    // Glass to air past the critical angle reflects everything.
    expect(fresnel(1.5, 1, 45 * D2R).tir).toBe(true);
    const shown = runMode(WAVE_OPTICS, 'fresnel', { n1: '1.5', n2: '1', theta: '30' });
    sig(value(shown, `${R}critical`) / D2R, 41.81);
  });
});

describe('apertures and polarization', () => {
  it('circular aperture: Rayleigh angle 1.21967 lambda / D, and J1 is right', () => {
    expect(besselJ1(1)).toBeCloseTo(0.44005058574493355, 12);
    expect(besselJ1(3.831705970207512)).toBeCloseTo(0, 12);
    const out = runMode(WAVE_OPTICS, 'circular', { lambda: '550', D: '5', R: '1000' });
    expect(value(out, `${R}angular`)).toBeCloseTo(Math.asin((1.2196698912665045 * 550e-9) / 5e-3), 15);
    expect(value(out, `${R}separation`)).toBeCloseTo(1000 * Math.tan(value(out, `${R}angular`)), 12);
  });

  it('Malus: unpolarized 100 through 0, 45, and 90 degrees gives 50, 25, 12.5', () => {
    expect(malus(100, [0, 45 * D2R, 90 * D2R], null).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([50, 25, 12.5]);
    expect(malus(1, [90 * D2R], 0)[0]).toBeCloseTo(0, 15);
    expect(value(runMode(WAVE_OPTICS, 'malus', {}), `${R}fraction`)).toBeCloseTo(0.125, 12);
  });

  it('Jones calculus: wave plates and polarizers', () => {
    // +45 linear through a quarter-wave plate with its fast axis horizontal becomes (1, i)/√2: left circular here.
    const left = jones({ input: 'diagonal', elements: 'quarter 0' });
    expect(word(left)).toBe('kitPhysics.waveoptics.state.circularCcw');
    expect(value(left, `${R}intensity`)).toBeCloseTo(1, 12);
    expect(word(jones({ input: 'diagonal', elements: 'quarter 90' }))).toBe('kitPhysics.waveoptics.state.circularCw');
    // A half-wave plate at 22.5 degrees turns horizontal light to 45 degrees.
    const turned = jones({ input: 'horizontal', elements: 'half 22.5' });
    expect(word(turned)).toBe('kitPhysics.waveoptics.state.linear');
    expect(value(turned, `${R}azimuth`)).toBeCloseTo(45 * D2R, 12);
    // A polarizer at 45 passes half of horizontal light; crossed polarizers pass none; circular through one, half.
    expect(value(jones({ input: 'horizontal', elements: 'polarizer 45' }), `${R}intensity`)).toBeCloseTo(0.5, 12);
    expect(word(jones({ input: 'horizontal', elements: 'polarizer 90' }))).toBe('kitPhysics.waveoptics.state.none');
    expect(value(jones({ input: 'right', elements: 'polarizer 0' }), `${R}intensity`)).toBeCloseTo(0.5, 12);
    // A 90-degree retarder is a quarter-wave plate; the custom (1, 1, 90 degrees) input is left circular, and a
    // half-wave plate flips its turn.
    expect(word(jones({ input: 'diagonal', elements: 'retarder 0 90' }))).toBe(
      'kitPhysics.waveoptics.state.circularCcw',
    );
    expect(word(jones({ input: 'custom', elements: 'half 0' }))).toBe('kitPhysics.waveoptics.state.circularCw');
    const elliptic = polarization([
      [1, 0],
      [0, 0.5],
    ]);
    expect(elliptic.kind).toBe('elliptical');
    expect(Math.tan(elliptic.ellipticity)).toBeCloseTo(0.5, 12);
  });

  it('stops with a message for impossible inputs', () => {
    expect(problem(runMode(WAVE_OPTICS, 'grating', { lines: '3000' }))).toBe('kitPhysics.waveoptics.errors.noOrders');
    expect(problem(runMode(WAVE_OPTICS, 'single', { a: '0.0001' }))).toBe('kitPhysics.waveoptics.errors.slitTooNarrow');
    expect(problem(runMode(WAVE_OPTICS, 'double', { a: '0.2' }))).toBe('kitPhysics.waveoptics.errors.slitTooNarrow');
    expect(problem(runMode(WAVE_OPTICS, 'film', { nAbove: '1.33' }))).toBe('kitPhysics.waveoptics.errors.noFilm');
    expect(problem(jones({ elements: 'mirror 0' }))).toBe('kitPhysics.waveoptics.errors.element');
    expect(problem(jones({ elements: 'retarder 0' }))).toBe('kitPhysics.waveoptics.errors.retardance');
    expect(problem(jones({ input: 'custom', ex: '0', ey: '0' }))).toBe('kitPhysics.waveoptics.errors.zeroLight');
    expect(problem(runMode(WAVE_OPTICS, 'malus', { angles: '' }))).toBe('kitPhysics.errors.noRows');
    expect(problem(runMode(WAVE_OPTICS, 'double', { lambda: '-600' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(WAVE_OPTICS, 'fresnel', { theta: '95' }))).toBe('kitPhysics.errors.range');
  });
});
