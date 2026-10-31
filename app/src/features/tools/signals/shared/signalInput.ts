// Reading a pasted signal: one value per line (or a run of values), or time and value on each line, in which case
// the sample rate comes from the evenly spaced times. Also the example signals the tools offer.
import { SignalError } from './errors';
import { gaussian, readNumbers, readRows, seededRandom } from './num';

export interface SignalText {
  readonly samples: number[];
  /** The rate the times give, when the text had a time column. */
  readonly rate?: number;
}

/** Values with their times, which must be evenly spaced and rising: the rate is one over the spacing. */
export function timedSignal(times: readonly number[], values: readonly number[]): SignalText {
  if (values.length === 0) throw new SignalError('empty');
  if (times.length !== values.length || times.length < 2) throw new SignalError('unevenTimes');
  const dt = (times[times.length - 1]! - times[0]!) / (times.length - 1);
  const even = dt > 0 && times.every((time, i) => Math.abs(time - (times[0]! + i * dt)) <= Math.abs(dt) * 1e-6 + 1e-12);
  if (!even) throw new SignalError('unevenTimes');
  return { samples: [...values], rate: 1 / dt };
}

export function readSignal(text: string): SignalText {
  const rows = readRows(text);
  if (rows.length > 1 && rows.every((row) => row.length === 2)) {
    return timedSignal(
      rows.map((row) => row[0]!),
      rows.map((row) => row[1]!),
    );
  }
  const samples = readNumbers(text);
  if (samples.length === 0) throw new SignalError('empty');
  return { samples };
}

/** A sum of sines with seeded noise: [frequency, amplitude] pairs, at a rate, for a duration in seconds. */
export function exampleSignal(
  tones: readonly (readonly [number, number])[],
  rate: number,
  seconds: number,
  noise = 0,
  seed = 1,
): number[] {
  const normal = gaussian(seededRandom(seed));
  return Array.from({ length: Math.round(rate * seconds) }, (_, i) => {
    let value = 0;
    for (const [f, a] of tones) value += a * Math.sin((2 * Math.PI * f * i) / rate);
    return value + noise * normal();
  });
}

/** Samples as text, one per line, rounded to keep the field short. */
export const samplesText = (samples: readonly number[], digits = 5): string =>
  samples.map((v) => Number(v.toFixed(digits)).toString()).join('\n');
