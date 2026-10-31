// Sound analysis and acoustics. The plan's validation cases come first, on synthetic signals whose answer is known by
// construction or by hand; edge cases follow.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import { lfilter } from '../filters/apply';
import {
  aWeighting,
  chaoContour,
  distanceChange,
  formants,
  generateTone,
  jitterShimmer,
  normalizeVowels,
  pitchTrack,
  pureToneAverage,
  speakerContour,
  subtractLevel,
  sumLevels,
  tuner,
} from './engine';

const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('pitch', () => {
  it('tracks a 220 Hz sawtooth at 16 kHz within 0.5 Hz in every voiced frame', () => {
    const fs = 16000;
    const x = Array.from({ length: fs / 2 }, (_, n) => 0.5 * (2 * ((220 * n) / fs - Math.floor((220 * n) / fs)) - 1));
    const track = pitchTrack(x, fs);
    const voiced = track.f0.filter(Number.isFinite);
    expect(voiced.length).toBeGreaterThan(0.9 * track.f0.length);
    for (const f of voiced) expect(Math.abs(f - 220)).toBeLessThan(0.5);
    const { jitter } = jitterShimmer(track);
    // A steady tone has far less jitter than the 1% often taken as the edge of a normal voice.
    expect(jitter).toBeLessThan(0.5);
  });

  it('calls silence unvoiced and refuses a recording shorter than one frame', () => {
    const track = pitchTrack(Array<number>(4000).fill(0), 16000);
    expect(track.f0.every(Number.isNaN)).toBe(true);
    expect(errorKey(() => pitchTrack([0, 0, 0], 16000))).toBe('tooShort');
  });
});

describe('formants', () => {
  it('finds F1, F2, F3 within 5% of 700, 1200, 2600 Hz in a synthetic vowel', () => {
    const fs = 10000;
    let x: number[] = Array.from({ length: fs / 2 }, (_, n) => (n % Math.round(fs / 120) === 0 ? 1 : 0));
    for (const [f, bw] of [
      [700, 80],
      [1200, 90],
      [2600, 120],
    ] as const) {
      const r = Math.exp((-Math.PI * bw) / fs);
      x = lfilter([1], [1, -2 * r * Math.cos((2 * Math.PI * f) / fs), r * r], x);
    }
    const found = formants(x.slice(2000, 2500), fs);
    [700, 1200, 2600].forEach((target, i) => {
      expect(Math.abs(found[i]!.frequency - target) / target).toBeLessThan(0.05);
    });
  });

  it('normalizes vowels by Lobanov z-scores and by the Bark scale', () => {
    const lobanov = normalizeVowels([300, 500, 700], [2300, 1500, 1100], 'lobanov');
    expect(lobanov.y.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    // Traunmüller: 26.81·1000/(1960 + 1000) − 0.53 = 8.527.
    expect(normalizeVowels([1000], [1000], 'bark').x[0]).toBeCloseTo(8.5274, 4);
    expect(errorKey(() => normalizeVowels([300], [0], 'none'))).toBe('vowelTable');
  });
});

describe('decibels and the tuner', () => {
  it('sums two 80 dB levels to 83.0103 dB and drops 12.0412 dB from 1 m to 4 m', () => {
    expect(Math.abs(sumLevels([80, 80]).level - 83.0103)).toBeLessThan(1e-4);
    expect(Math.abs(distanceChange(1, 4) + 12.0412)).toBeLessThan(1e-4);
    expect(subtractLevel(83.0103, 80)).toBeCloseTo(80, 3);
    expect(errorKey(() => subtractLevel(70, 80))).toBe('levelOrder');
  });

  it('A-weights 1 kHz by about 0 dB and 100 Hz by −19.14 dB', () => {
    expect(Math.abs(aWeighting(1000) - 0.0001415)).toBeLessThan(0.01);
    expect(Math.abs(aWeighting(100) + 19.14)).toBeLessThan(0.01);
  });

  it('reads 445 Hz as A4 + 19.562 cents with A4 = 440', () => {
    const reading = tuner(445, 440);
    expect(reading.note).toBe('A4');
    expect(Math.abs(reading.cents - 19.562)).toBeLessThan(1e-3);
    expect(tuner(261.6256, 440).note).toBe('C4');
    expect(errorKey(() => tuner(-1))).toBe('frequency');
  });
});

describe('tones, audiograms, and the generator', () => {
  it('turns Chao 214 into a dip and 55 into a high level line', () => {
    const dip = chaoContour('214', 5);
    expect(dip[0]).toBeCloseTo(-3, 12);
    expect(dip[2]).toBeCloseTo(-6, 12);
    expect(dip[4]).toBeCloseTo(3, 12);
    expect(chaoContour('55', 3)).toEqual([6, 6, 6]);
    expect(errorKey(() => chaoContour('7'))).toBe('chao');
  });

  it('centers a speaker contour on its own mean', () => {
    const contour = speakerContour([200, 200, 400, 400], 4);
    expect(contour[0]).toBeCloseTo(-6, 9);
    expect(contour[3]).toBeCloseTo(6, 9);
  });

  it('averages 500, 1000, and 2000 Hz for the pure-tone average', () => {
    expect(pureToneAverage({ 500: 20, 1000: 30, 2000: 40, 4000: 70 })).toBe(30);
    expect(pureToneAverage({ 500: 20, 1000: 30, 2000: 40, 4000: 70 }, true)).toBe(40);
    expect(errorKey(() => pureToneAverage({ 500: 20 }))).toBe('ptaFrequencies');
  });

  it('makes a tone with its peak at 0.9 and silent ends', () => {
    const tone = generateTone({ f0: 220, harmonics: 5, rolloff: 1, duration: 0.5, attack: 0.05, release: 0.05 }, 8000);
    expect(Math.max(...tone.map(Math.abs))).toBeCloseTo(0.9, 9);
    expect(tone[0]).toBe(0);
    expect(
      errorKey(() => generateTone({ f0: 5000, harmonics: 1, rolloff: 1, duration: 1, attack: 0, release: 0 }, 8000)),
    ).toBe('frequency');
  });
});
