// The spectrum analyzer's engine: one-sided amplitude, power, and density spectra with window corrections, Welch's
// averaged density, the short-time spectrogram, band powers, peaks, and damping from half-power points.
import { fft, makeWindow, windowFigures, type WindowName } from '../shared/fft';
import { SignalError } from '../shared/errors';
import { fmt, mean, readNumbers } from '../shared/num';
import { step, type Step } from '../shared/steps';

export type Detrend = 'none' | 'mean' | 'linear';
export type Scaling = 'amplitude' | 'power' | 'psd';

export interface SpectrumInput {
  readonly samples: readonly number[];
  readonly rate: number;
  readonly window: WindowName;
  readonly detrend: Detrend;
  /** Kaiser's beta, when that window is chosen. */
  readonly beta?: number;
}

export interface SpectrumResult {
  readonly freq: Float64Array;
  /** One-sided amplitude: a sine of amplitude A reads A at its bin. */
  readonly amplitude: Float64Array;
  /** One-sided power: A^2 / 2 for a sine of amplitude A. */
  readonly power: Float64Array;
  /** One-sided power spectral density, in units^2 per Hz. */
  readonly psd: Float64Array;
  readonly n: number;
  readonly binWidth: number;
  readonly coherentGain: number;
  /** Equivalent noise bandwidth in bins. */
  readonly enbw: number;
  /** Mean square of the samples and the same from the spectrum (Parseval), after detrending and windowing. */
  readonly parseval: { readonly time: number; readonly frequency: number };
  readonly steps: Step[];
}

/** The samples less their mean or their least-squares line. */
export function detrend(samples: readonly number[], how: Detrend): number[] {
  if (how === 'none' || samples.length === 0) return [...samples];
  if (how === 'mean' || samples.length < 2) {
    const m = mean(samples);
    return samples.map((x) => x - m);
  }
  const n = samples.length;
  const tMean = (n - 1) / 2;
  const xMean = mean(samples);
  let num = 0;
  let den = 0;
  samples.forEach((x, i) => {
    num += (i - tMean) * (x - xMean);
    den += (i - tMean) ** 2;
  });
  const slope = num / den;
  return samples.map((x, i) => x - (xMean + slope * (i - tMean)));
}

function checkInput(input: SpectrumInput): void {
  if (input.samples.length < 2) throw new SignalError('tooFewSamples', { count: 2 });
  if (!(input.rate > 0) || !Number.isFinite(input.rate)) throw new SignalError('sampleRate');
  if (input.samples.some((x) => !Number.isFinite(x))) throw new SignalError('notFinite');
}

/** The one-sided spectra of the whole record, with every correction the window needs. */
export function spectrum(input: SpectrumInput): SpectrumResult {
  checkInput(input);
  const x = detrend(input.samples, input.detrend);
  const n = x.length;
  const w = makeWindow(input.window, n, false, input.beta);
  const { coherentGain, enbw, sumSquares } = windowFigures(w);
  const xw = x.map((v, i) => v * w[i]!);
  const X = fft(xw);
  const half = Math.floor(n / 2);
  const bins = half + 1;
  const freq = new Float64Array(bins);
  const amplitude = new Float64Array(bins);
  const power = new Float64Array(bins);
  const psd = new Float64Array(bins);
  let spectral = 0;
  for (let k = 0; k < n; k += 1) spectral += X.re[k]! ** 2 + X.im[k]! ** 2;
  for (let k = 0; k < bins; k += 1) {
    const magnitude = Math.hypot(X.re[k]!, X.im[k]!);
    const interior = k !== 0 && !(n % 2 === 0 && k === half);
    const one = magnitude / (n * coherentGain);
    freq[k] = (k * input.rate) / n;
    amplitude[k] = interior ? 2 * one : one;
    power[k] = interior ? 2 * one * one : one * one;
    psd[k] = ((interior ? 2 : 1) * magnitude * magnitude) / (input.rate * sumSquares);
  }
  const time = xw.reduce((total, v) => total + v * v, 0);
  const steps = [
    step('spectrumRecord', `N = ${n}, fs = ${fmt(input.rate)} Hz, Δf = fs/N = ${fmt(input.rate / n)} Hz`),
    step('spectrumWindow', `CG = mean(w) = ${fmt(coherentGain)}, ENBW = N Σw² / (Σw)² = ${fmt(enbw)} bins`),
    step('spectrumDft', 'X_k = Σ x_n w_n e^(−2πikn/N)'),
    step('spectrumScaling', 'A_k = 2|X_k| / (N · CG) (interior bins), PSD_k = 2|X_k|² / (fs Σw²)'),
    step('spectrumParseval', `Σ|x w|² = ${fmt(time)}, (1/N) Σ|X|² = ${fmt(spectral / n)}`),
  ];
  return {
    freq,
    amplitude,
    power,
    psd,
    n,
    binWidth: input.rate / n,
    coherentGain,
    enbw,
    parseval: { time, frequency: spectral / n },
    steps,
  };
}

export interface WelchInput extends SpectrumInput {
  readonly segment: number;
  /** Overlap as a fraction of the segment, 0 to 0.95. */
  readonly overlap: number;
}

/** Welch's method: the density averaged over windowed, overlapping segments. */
export function welch(input: WelchInput): { freq: Float64Array; psd: Float64Array; segments: number; steps: Step[] } {
  checkInput(input);
  const segment = Math.round(input.segment);
  if (segment < 2 || segment > input.samples.length) throw new SignalError('segmentLength');
  if (!(input.overlap >= 0 && input.overlap <= 0.95)) throw new SignalError('overlap');
  const hop = Math.max(1, Math.round(segment * (1 - input.overlap)));
  let total: Float64Array | null = null;
  let freq: Float64Array = new Float64Array(0);
  let count = 0;
  for (let start = 0; start + segment <= input.samples.length; start += hop) {
    const part = spectrum({ ...input, samples: input.samples.slice(start, start + segment) });
    total = total ?? new Float64Array(part.psd.length);
    for (let k = 0; k < part.psd.length; k += 1) total[k] = total[k]! + part.psd[k]!;
    freq = part.freq;
    count += 1;
  }
  const psd = total!.map((v) => v / count);
  const steps = [
    step('welchSegments', `L = ${segment}, hop = ${hop}, K = ${count}`),
    step('welchAverage', 'PSD(f) = (1/K) Σ PSD_k(f)'),
  ];
  return { freq, psd, segments: count, steps };
}

export interface Spectrogram {
  /** Columns are times, rows are frequency bins, values are density in dB. */
  readonly rows: Float64Array[];
  readonly times: Float64Array;
  readonly maxFreq: number;
}

/** The short-time Fourier transform's density in dB, one column per hop. */
export function spectrogram(input: WelchInput): Spectrogram {
  checkInput(input);
  const segment = Math.round(input.segment);
  if (segment < 2 || segment > input.samples.length) throw new SignalError('segmentLength');
  const hop = Math.max(1, Math.round(segment * (1 - Math.min(0.95, Math.max(0, input.overlap)))));
  const columns: Float64Array[] = [];
  const times: number[] = [];
  for (let start = 0; start + segment <= input.samples.length; start += hop) {
    const part = spectrum({ ...input, samples: input.samples.slice(start, start + segment) });
    columns.push(part.psd.map((p) => 10 * Math.log10(Math.max(p, 1e-30))));
    times.push((start + segment / 2) / input.rate);
  }
  const bins = columns[0]!.length;
  const rows = Array.from({ length: bins }, (_, k) => Float64Array.from(columns, (column) => column[k]!));
  return { rows, times: Float64Array.from(times), maxFreq: input.rate / 2 };
}

export interface Band {
  readonly name: string;
  readonly low: number;
  readonly high: number;
}

/** The usual EEG bands, in Hz. */
export const EEG_BANDS: readonly Band[] = [
  { name: 'delta', low: 0.5, high: 4 },
  { name: 'theta', low: 4, high: 8 },
  { name: 'alpha', low: 8, high: 13 },
  { name: 'beta', low: 13, high: 30 },
  { name: 'gamma', low: 30, high: 45 },
];

/** Bands typed one per line: a name, then the lower and upper edges in hertz. */
export function readBands(text: string): Band[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const words = line.split(/\s+/);
      if (words.length < 3) throw new SignalError('bandLine', { text: line.slice(0, 32) });
      const [low, high] = readNumbers(words.slice(-2).join(' '));
      return { name: words.slice(0, -2).join(' '), low: low!, high: high! };
    });
}

/** Power in each band, the density summed over the bins inside it times the bin width, and as a share of all. */
export function bandPowers(
  freq: ArrayLike<number>,
  psd: ArrayLike<number>,
  bands: readonly Band[],
): { band: Band; power: number; relative: number }[] {
  if (freq.length < 2) throw new SignalError('tooFewSamples', { count: 2 });
  const df = freq[1]! - freq[0]!;
  let total = 0;
  for (let k = 0; k < psd.length; k += 1) total += psd[k]! * df;
  return bands.map((band) => {
    if (!(band.high > band.low)) throw new SignalError('bandOrder', { name: band.name });
    let power = 0;
    for (let k = 0; k < psd.length; k += 1) if (freq[k]! >= band.low && freq[k]! < band.high) power += psd[k]! * df;
    return { band, power, relative: total > 0 ? power / total : 0 };
  });
}

/**
 * The tallest local maxima, largest first, with the peak's frequency refined by a parabola through the logarithms of
 * three bins. On a log scale a Gaussian-shaped peak is exactly a parabola, so the vertex lands far nearer the true
 * frequency than a parabola through linear values does (for a Hann window, a few thousandths of a bin rather than
 * about a twentieth). Where a neighbor is at the numerical floor the linear values are used.
 */
export function peaks(
  freq: ArrayLike<number>,
  values: ArrayLike<number>,
  count = 5,
): { freq: number; value: number }[] {
  const found: { freq: number; value: number }[] = [];
  const df = freq.length > 1 ? freq[1]! - freq[0]! : 0;
  for (let k = 1; k < values.length - 1; k += 1) {
    const [a, b, c] = [values[k - 1]!, values[k]!, values[k + 1]!];
    if (b > a && b >= c && b > 0) {
      const logScale = a > b * 1e-9 && c > b * 1e-9;
      const [la, lb, lc] = logScale ? [Math.log(a), Math.log(b), Math.log(c)] : [a, b, c];
      const curve = la - 2 * lb + lc;
      const shift = curve === 0 ? 0 : (0.5 * (la - lc)) / curve;
      found.push({ freq: freq[k]! + shift * df, value: b });
    }
  }
  return found.sort((p, q) => q.value - p.value).slice(0, count);
}

/** The damping ratio from the half-power points around a resonance: zeta = (f2 − f1) / (2 fn). */
export function halfPowerDamping(f1: number, f2: number, fn: number): { zeta: number; q: number; steps: Step[] } {
  if (!(f1 > 0 && f2 > f1 && fn > f1 && fn < f2)) throw new SignalError('halfPowerOrder');
  const zeta = (f2 - f1) / (2 * fn);
  return {
    zeta,
    q: 1 / (2 * zeta),
    steps: [
      step('halfPower', `ζ = (f₂ − f₁) / (2 fₙ) = (${fmt(f2)} − ${fmt(f1)}) / (2 · ${fmt(fn)}) = ${fmt(zeta)}`),
      step('qualityFactor', `Q = 1 / (2ζ) = ${fmt(1 / (2 * zeta))}`),
    ],
  };
}

/** The half-power frequencies either side of the tallest peak of a magnitude spectrum, by linear interpolation. */
export function halfPowerPoints(freq: ArrayLike<number>, magnitude: ArrayLike<number>): [number, number, number] {
  let top = 0;
  for (let k = 1; k < magnitude.length; k += 1) if (magnitude[k]! > magnitude[top]!) top = k;
  const level = magnitude[top]! / Math.SQRT2;
  const cross = (from: number, direction: 1 | -1): number => {
    for (let k = from; k + direction >= 0 && k + direction < magnitude.length; k += direction) {
      const next = k + direction;
      if (magnitude[next]! <= level) {
        const share = (magnitude[k]! - level) / (magnitude[k]! - magnitude[next]!);
        return freq[k]! + share * (freq[next]! - freq[k]!);
      }
    }
    throw new SignalError('noHalfPower');
  };
  return [cross(top, -1), cross(top, 1), freq[top]!];
}
