// The waves and sound tool against its validation cases (first principles) and an independent working of each.
import '../text';
import { describe, expect, it } from 'vitest';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import { beatFrequency, doppler, pipeModes, soundLevel, stringWave, superpose } from './engine';
import { WAVES } from './spec';

const rel = (got: number, want: number, tol: number) => expect(Math.abs(got - want) / Math.abs(want)).toBeLessThan(tol);
/** The plan states these answers to 5 significant figures. */
const sig = (got: number, want: number, digits = 5) => expect(Number(got.toPrecision(digits))).toBe(want);

describe('waves and sound', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(WAVES)).toEqual([]);
  });

  it('string: T 70 N, mu 0.5 g/m, L 0.65 m gives v 374.17 m/s and f1 287.82 Hz', () => {
    const out = runMode(WAVES, 'string', { T: '70', mu: '0.5', L: '0.65' });
    sig(value(out, 'kitPhysics.waves.r.speed'), 374.17);
    sig(value(out, 'kitPhysics.waves.r.harmonic', 'f₁'), 287.82);
    // Independently: sqrt(70 / 0.0005) and that over 2 L.
    rel(value(out, 'kitPhysics.waves.r.speed'), Math.sqrt(140_000), 1e-12);
    rel(value(out, 'kitPhysics.waves.r.harmonic', 'f₃'), (3 * Math.sqrt(140_000)) / 1.3, 1e-12);
  });

  it('string in US units: the same string typed in lbf, lb/ft, and ft', () => {
    const lbf = 70 / 4.4482216152605;
    const lbft = 0.0005 / (0.45359237 / 0.3048);
    const ft = 0.65 / 0.3048;
    const out = runMode(WAVES, 'string', { T: String(lbf), mu: String(lbft), L: String(ft) }, { system: 'US' });
    rel(value(out, 'kitPhysics.waves.r.harmonic', 'f₁'), 287.8198, 1e-6);
  });

  it('pipe closed at one end, 0.5 m, 343 m/s: f1 171.5 Hz and only odd harmonics', () => {
    const modes = pipeModes(0.5, 343, 'closed', 4);
    expect(modes[0].f).toBeCloseTo(171.5, 9);
    expect(modes.map((m) => m.n)).toEqual([1, 3, 5, 7]);
    expect(modes[2].f).toBeCloseTo(5 * 171.5, 9);
    const open = pipeModes(0.5, 343, 'open', 3);
    expect(open.map((m) => m.f)).toEqual([343, 686, 1029]);
    expect(value(runMode(WAVES, 'pipe', { L: '0.5', v: '343' }), 'kitPhysics.waves.r.harmonic', 'f₁')).toBeCloseTo(
      171.5,
      9,
    );
  });

  it('Doppler: 500 Hz source approaching at 30 m/s in 343 m/s air gives 547.92 Hz', () => {
    sig(doppler(500, 343, 30, 0), 547.92);
    rel(doppler(500, 343, 30, 0), (500 * 343) / 313, 1e-14);
    // Receding source and an approaching observer.
    rel(doppler(500, 343, -30, 0), (500 * 343) / 373, 1e-14);
    rel(doppler(500, 343, 0, 30), (500 * 373) / 343, 1e-14);
    const away = runMode(WAVES, 'doppler', { vs: '30', sm: 'away' });
    rel(value(away, 'kitPhysics.waves.r.heard'), (500 * 343) / 373, 1e-12);
  });

  it('Doppler refuses a source at the speed of sound and an observer that outruns it', () => {
    expect(problem(runMode(WAVES, 'doppler', { vs: '343' }))).toBe('kitPhysics.waves.errors.supersonic');
    expect(problem(runMode(WAVES, 'doppler', { vs: '0', vo: '400', om: 'away' }))).toBe(
      'kitPhysics.waves.errors.outrun',
    );
  });

  it('sound level: 1e-5 W/m² is 70.0 dB, and back', () => {
    expect(soundLevel(1e-5)).toBeCloseTo(70, 9);
    const back = runMode(WAVES, 'level', { given: 'level', beta: '70' });
    rel(value(back, 'kitPhysics.waves.r.intensity'), 1e-5, 1e-12);
    // A 1 W point source at 10 m: I = 1 / (400 pi), 89.008 dB.
    const source = runMode(WAVES, 'level', { given: 'source', P: '1', r: '10' });
    rel(value(source, 'kitPhysics.waves.r.intensity'), 1 / (400 * Math.PI), 1e-12);
    rel(value(source, 'kitPhysics.waves.r.level'), 10 * Math.log10(1 / (400 * Math.PI) / 1e-12), 1e-12);
  });

  it('beats and two waves together', () => {
    expect(beatFrequency(440, 444)).toBe(4);
    const out = runMode(WAVES, 'beats', { f1: '440', f2: '444' });
    expect(value(out, 'kitPhysics.waves.r.beatPeriod')).toBeCloseTo(0.25, 12);
    const sum = superpose(1, 1, Math.PI / 3);
    expect(sum.amplitude).toBeCloseTo(Math.sqrt(3), 12);
    expect(sum.phase).toBeCloseTo(Math.PI / 6, 12);
    expect(superpose(2, 1, Math.PI).kind).toBe('destructive');
    expect(superpose(2, 1, Math.PI).amplitude).toBeCloseTo(1, 12);
    expect(superpose(2, 1, 0).kind).toBe('constructive');
    expect(problem(runMode(WAVES, 'superpose', { a1: '0', a2: '0' }))).toBe('kitPhysics.waves.errors.zeroAmplitude');
  });

  it('stops with a message for zero, negative, missing, and odd inputs', () => {
    expect(problem(runMode(WAVES, 'string', { T: '0' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(WAVES, 'string', { mu: '-1' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(WAVES, 'string', { L: '' }))).toBe('kitPhysics.errors.missing');
    expect(problem(runMode(WAVES, 'string', { L: 'abc' }))).toBe('kitPhysics.errors.notNumber');
    expect(problem(runMode(WAVES, 'string', { n: '2.5' }))).toBe('kitPhysics.errors.range');
    expect(problem(runMode(WAVES, 'string', { n: '50' }))).toBe('kitPhysics.errors.range');
    expect(problem(runMode(WAVES, 'level', { I: '0' }))).toBe('kitPhysics.errors.positive');
    // A huge tension still gives finite numbers.
    const huge = stringWave(1e30, 1e-3, 1, 1);
    expect(Number.isFinite(huge.harmonics[0].f)).toBe(true);
  });
});
