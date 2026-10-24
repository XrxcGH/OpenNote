// Tuning systems: equal temperaments, just intonation, Pythagorean, quarter-comma meantone, and two well
// temperaments (Werckmeister III and Kirnberger III) built from the sizes of their fifths, plus beat rates and the
// harmonic series. Everything is in cents from the tonic C unless a name says otherwise.
import { centsOf, midiToHz, nearestNote, ratioOf } from '../pitch';
import type { NearestNote } from '../pitch';

export const PURE_FIFTH = centsOf(3 / 2);
/** The Pythagorean comma: twelve pure fifths overshoot seven octaves by this much (3^12 / 2^19). */
export const PYTHAGOREAN_COMMA = centsOf(3 ** 12 / 2 ** 19);
/** The syntonic comma, 81/80. */
export const SYNTONIC_COMMA = centsOf(81 / 80);
/** The fifth of quarter-comma meantone: 3/2 narrowed by a quarter of the syntonic comma, which is 5^(1/4). */
export const QUARTER_COMMA_FIFTH = centsOf(5 ** 0.25);

export type TuningId = 'equal' | 'just' | 'pythagorean' | 'meantone' | 'werckmeister' | 'kirnberger';

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'] as const;

/**
 * The twelve fifths of the circle in the order C-G, G-D, D-A, A-E, E-B, B-F#, F#-C#, C#-G#, G#-Eb, Eb-Bb, Bb-F,
 * F-C. A `null` is the one fifth that closes the circle (the wolf), so the twelve add up to seven octaves.
 */
export type FifthCircle = readonly (number | null)[];

const pure = PURE_FIFTH;
const q = QUARTER_COMMA_FIFTH;
const narrow = PURE_FIFTH - PYTHAGOREAN_COMMA / 4;

export const CIRCLES: Partial<Record<TuningId, FifthCircle>> = {
  equal: Array.from({ length: 12 }, () => 700),
  pythagorean: [pure, pure, pure, pure, pure, pure, pure, pure, null, pure, pure, pure],
  meantone: [q, q, q, q, q, q, q, q, null, q, q, q],
  // Werckmeister III: C-G, G-D, D-A, and B-F# are narrowed by a quarter of the Pythagorean comma; the rest are pure.
  werckmeister: [narrow, narrow, narrow, pure, pure, narrow, pure, pure, pure, pure, pure, pure],
  // Kirnberger III: C-G, G-D, D-A, and A-E are quarter-comma fifths, so C-E is a pure 5/4; F#-C# closes the circle.
  kirnberger: [q, q, q, q, pure, pure, null, pure, pure, pure, pure, pure],
};

/** Just intonation, five-limit: the usual twelve ratios over one tonic. */
export const JUST_RATIOS = [
  1,
  16 / 15,
  9 / 8,
  6 / 5,
  5 / 4,
  4 / 3,
  45 / 32,
  3 / 2,
  8 / 5,
  5 / 3,
  9 / 5,
  15 / 8,
] as const;

const wrap = (cents: number): number => ((cents % 1200) + 1200) % 1200;

/** The sizes of the twelve fifths with the closing one filled in. */
export function fifths(circle: FifthCircle): number[] {
  const known = circle.reduce<number>((sum, f) => sum + (f ?? 0), 0);
  return circle.map((f) => f ?? 8400 - known);
}

/** The twelve notes from C (C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B) in cents, for a tuning. */
export function tuningCents(id: TuningId): number[] {
  if (id === 'just') return JUST_RATIOS.map(centsOf);
  const circle = CIRCLES[id]!;
  const sizes = fifths(circle);
  // Positions along the circle: C, G, D, A, E, B, F#, C#, G#, Eb, Bb, F; mapped to chromatic order.
  const order = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const cents = new Array<number>(12).fill(0);
  let at = 0;
  order.forEach((degree, i) => {
    cents[degree] = wrap(at);
    at += sizes[i]!;
  });
  return cents;
}

export interface TuningNote {
  name: string;
  cents: number;
  hz: number;
  /** Cents above or below the equal-tempered note of the same name. */
  versusEqual: number;
}

/** C4 in an equal-tempered scale with the given A4. */
export const middleC = (a4: number): number => midiToHz(60, a4);

export function tuningTable(id: TuningId, a4 = 440): TuningNote[] {
  const c = middleC(a4);
  return tuningCents(id).map((cents, i) => ({
    name: NOTE_NAMES[i]!,
    cents,
    hz: c * ratioOf(cents),
    versusEqual: cents - i * 100,
  }));
}

/** The beat rate of an interval that is nearly p:q: the partials q×f2 and p×f1 beat at |q×f2 − p×f1|. */
export function beatRate(f1: number, f2: number, p: number, qq: number): number {
  return Math.abs(qq * f2 - p * f1);
}

/** The size in cents of the interval between two chromatic degrees (0 to 11) of a tuning, going up. */
export function intervalCents(cents: readonly number[], from: number, steps: number): number {
  const to = from + steps;
  const upper = cents[to % 12]! + 1200 * Math.floor(to / 12);
  return upper - cents[from]!;
}

export interface TunedInterval {
  name: 'fifth' | 'fourth' | 'majorThird' | 'minorThird';
  cents: number;
  /** Difference from the pure ratio in cents. */
  error: number;
  /** Beats per second between C4 and the note above (or the equivalent). */
  beats: number;
}

const INTERVALS = [
  { name: 'fifth', steps: 7, ratio: [3, 2] },
  { name: 'fourth', steps: 5, ratio: [4, 3] },
  { name: 'majorThird', steps: 4, ratio: [5, 4] },
  { name: 'minorThird', steps: 3, ratio: [6, 5] },
] as const;

/** The common intervals built on a tonic degree (0 is C) in a tuning, with their error and beat rate. */
export function tunedIntervals(id: TuningId, tonic: number, a4 = 440): TunedInterval[] {
  const cents = tuningCents(id);
  const base = middleC(a4) * ratioOf(cents[tonic]!);
  return INTERVALS.map(({ name, steps, ratio }) => {
    const size = intervalCents(cents, tonic, steps);
    const upper = base * ratioOf(size);
    return {
      name,
      cents: size,
      error: size - centsOf(ratio[0] / ratio[1]),
      beats: beatRate(base, upper, ratio[0], ratio[1]),
    };
  });
}

export interface HarmonicPartial {
  n: number;
  cents: number;
  hz: number;
  nearest: NearestNote;
}

/** The first partials of a harmonic series over a fundamental. */
export function harmonicSeries(fundamental: number, count: number): HarmonicPartial[] {
  return Array.from({ length: count }, (_, i) => {
    const hz = fundamental * (i + 1);
    return { n: i + 1, cents: centsOf(i + 1), hz, nearest: nearestNote(hz) };
  });
}

/** Cents of a step in an n-tone equal temperament. */
export const stepCents = (n: number): number => 1200 / n;

/** The note of an n-tone equal temperament nearest to an interval in cents: its step number and the error. */
export function nearestStep(n: number, cents: number): { step: number; error: number } {
  const step = Math.round(cents / stepCents(n));
  return { step, error: step * stepCents(n) - cents };
}
