// Sound analysis and acoustics. Pitch is found by YIN (de Cheveigné and Kawahara 2002) with intensity, jitter, and
// shimmer beside it; then formants by Burg LPC, vowel normalization, a tuner, tone contours in Chao numbers, audiograms, decibel arithmetic
// with IEC 61672 A-weighting, and a tone generator. Samples are numbers from −1 to 1. Pure: no DOM.
import { SignalError } from '../shared/errors';
import { fmt, polyRoots } from '../shared/num';
import { step, type Step } from '../shared/steps';

export interface PitchTrack {
  /** Frame centers in seconds. */
  times: number[];
  /** f0 in hertz, NaN where the frame is unvoiced. */
  f0: number[];
  /** Intensity in dB re full scale (a full-scale sine is −3 dB). */
  db: number[];
  /** The largest absolute sample of each frame, for shimmer. */
  peaks: number[];
}

export interface YinOptions {
  fmin?: number;
  fmax?: number;
  threshold?: number;
  frame?: number;
  hop?: number;
  /** Frames quieter than this (dB re full scale) are unvoiced. */
  silence?: number;
}

/** The YIN estimate for one frame: the period in samples (with parabolic interpolation) and its aperiodicity. */
function yinFrame(x: readonly number[], start: number, w: number, minLag: number, maxLag: number, threshold: number) {
  const d = new Float64Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau += 1) {
    let total = 0;
    for (let j = start; j < start + w; j += 1) {
      const diff = x[j]! - x[j + tau]!;
      total += diff * diff;
    }
    d[tau] = total;
  }
  // Cumulative-mean-normalized difference: d'(τ) = d(τ) / ((1/τ) Σ_{j≤τ} d(j)).
  const cmnd = new Float64Array(maxLag + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag + 1; tau += 1) {
    running += d[tau]!;
    cmnd[tau] = running > 0 ? (d[tau]! * tau) / running : 1;
  }
  let best = -1;
  for (let tau = minLag; tau <= maxLag; tau += 1) {
    if (cmnd[tau]! < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1]! < cmnd[tau]!) tau += 1;
      best = tau;
      break;
    }
  }
  if (best < 0) {
    // No dip under the threshold: take the global minimum, and call it unvoiced if it is still high.
    best = minLag;
    for (let tau = minLag; tau <= maxLag; tau += 1) if (cmnd[tau]! < cmnd[best]!) best = tau;
  }
  // Refine the period between samples: the difference function at fractional lags (linear interpolation of the
  // signal), minimized by golden-section search within a sample of the best whole lag.
  const at = (lag: number) => {
    const whole = Math.floor(lag);
    const part = lag - whole;
    let total = 0;
    for (let j = start; j < start + w; j += 1) {
      const later = x[j + whole]! + part * (x[j + whole + 1]! - x[j + whole]!);
      total += (x[j]! - later) ** 2;
    }
    return total;
  };
  let lo = Math.max(1, best - 1);
  let hi = Math.min(maxLag, best + 1);
  const golden = (Math.sqrt(5) - 1) / 2;
  let p = hi - golden * (hi - lo);
  let q = lo + golden * (hi - lo);
  let fp = at(p);
  let fq = at(q);
  for (let i = 0; i < 30; i += 1) {
    if (fp < fq) {
      [hi, q, fq] = [q, p, fp];
      p = hi - golden * (hi - lo);
      fp = at(p);
    } else {
      [lo, p, fp] = [p, q, fq];
      q = lo + golden * (hi - lo);
      fq = at(q);
    }
  }
  return { period: (lo + hi) / 2, aperiodicity: cmnd[best]!, cmnd };
}

/** A pitch and intensity track. An octave-jump guard prefers half or double a frame's f0 when that is as periodic. */
export function pitchTrack(x: readonly number[], fs: number, options: YinOptions = {}): PitchTrack {
  if (!(fs > 0)) throw new SignalError('sampleRate');
  const fmin = options.fmin ?? 60;
  const fmax = options.fmax ?? 600;
  if (!(fmin > 0 && fmax > fmin && fmax < fs / 4)) throw new SignalError('pitchRange');
  const threshold = options.threshold ?? 0.15;
  const w = Math.round((options.frame ?? 0.03) * fs);
  const hop = Math.max(1, Math.round((options.hop ?? 0.01) * fs));
  const minLag = Math.max(2, Math.floor(fs / fmax));
  const maxLag = Math.ceil(fs / fmin);
  if (x.length < w + maxLag + 2) throw new SignalError('tooShort');
  const silence = options.silence ?? -50;
  const track: PitchTrack = { times: [], f0: [], db: [], peaks: [] };
  let previous = Number.NaN;
  for (let start = 0; start + w + maxLag + 2 <= x.length; start += hop) {
    let energy = 0;
    let peak = 0;
    for (let j = start; j < start + w; j += 1) {
      energy += x[j]! * x[j]!;
      peak = Math.max(peak, Math.abs(x[j]!));
    }
    const db = 10 * Math.log10(Math.max(energy / w, 1e-12));
    const frame = yinFrame(x, start, w, minLag, maxLag, threshold);
    let f0 = frame.aperiodicity < 2 * threshold && db > silence ? fs / frame.period : Number.NaN;
    if (Number.isFinite(f0) && Number.isFinite(previous)) {
      // Guard: a jump of an octave against the last voiced frame is taken back if the other lag is periodic too.
      for (const factor of [2, 0.5]) {
        const ratio = f0 / previous;
        if (Math.abs(ratio * factor - 1) < 0.12) {
          const lag = Math.round(frame.period / factor);
          if (lag >= minLag && lag <= maxLag && frame.cmnd[lag]! < 2 * threshold) f0 = fs / lag;
        }
      }
    }
    if (Number.isFinite(f0)) previous = f0;
    track.times.push((start + w / 2) / fs);
    track.f0.push(f0);
    track.db.push(db);
    track.peaks.push(peak);
  }
  return track;
}

/** Local jitter and shimmer from the voiced frames: mean change between neighbors over the mean, as a percent. */
export function jitterShimmer(track: PitchTrack): { jitter: number; shimmer: number; voiced: number } {
  const periods: number[] = [];
  const amps: number[] = [];
  track.f0.forEach((f, i) => {
    if (Number.isFinite(f)) {
      periods.push(1 / f);
      amps.push(track.peaks[i]!);
    }
  });
  if (periods.length < 3) throw new SignalError('tooFewVoiced');
  const local = (v: number[]) => {
    let change = 0;
    for (let i = 1; i < v.length; i += 1) change += Math.abs(v[i]! - v[i - 1]!);
    return (100 * change) / (v.length - 1) / (v.reduce((a, b) => a + b, 0) / v.length);
  };
  return { jitter: local(periods), shimmer: local(amps), voiced: periods.length };
}

/** LPC coefficients a[0] = 1, a[1…p] by Burg's method. */
export function burg(x: readonly number[], order: number): number[] {
  const n = x.length;
  if (n <= order + 1) throw new SignalError('tooShort');
  let a = [1];
  let f = [...x];
  let b = [...x];
  for (let m = 1; m <= order; m += 1) {
    let num = 0;
    let den = 0;
    for (let i = m; i < n; i += 1) {
      num += f[i]! * b[i - 1]!;
      den += f[i]! * f[i]! + b[i - 1]! * b[i - 1]!;
    }
    const k = den > 0 ? (-2 * num) / den : 0;
    // Levinson's update: a_new[i] = a[i] + k·a[m − i], with a[m] = 0, so a_new[m] = k.
    const next = [...a, 0];
    for (let i = 1; i <= m; i += 1) next[i] = (a[i] ?? 0) + k * a[m - i]!;
    a = next;
    const fNext = [...f];
    const bNext = [...b];
    for (let i = m; i < n; i += 1) {
      fNext[i] = f[i]! + k * b[i - 1]!;
      bNext[i] = b[i - 1]! + k * f[i]!;
    }
    f = fNext;
    b = bNext;
  }
  return a;
}

export interface Formant {
  frequency: number;
  bandwidth: number;
}

/**
 * Formants of a segment: pre-emphasis, a Hamming window, Burg LPC of order 2 + fs/1000, and the angles of the
 * polynomial's roots. Roots below 90 Hz or wider than 400 Hz are not formants.
 */
export function formants(segment: readonly number[], fs: number, order = Math.round(2 + fs / 1000)): Formant[] {
  if (segment.length < 64) throw new SignalError('tooShort');
  const emphasized = segment.map((v, i) => v - 0.97 * (i > 0 ? segment[i - 1]! : 0));
  const n = emphasized.length;
  const windowed = emphasized.map((v, i) => v * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const a = burg(windowed, order);
  return polyRoots(a)
    .filter((z) => z.im > 0)
    .map((z) => ({
      frequency: (Math.atan2(z.im, z.re) * fs) / (2 * Math.PI),
      bandwidth: (-fs / Math.PI) * Math.log(Math.hypot(z.re, z.im)),
    }))
    .filter((one) => one.frequency > 90 && one.frequency < fs / 2 - 50 && one.bandwidth < 400)
    .sort((p, q) => p.frequency - q.frequency);
}

export type Normalization = 'none' | 'lobanov' | 'bark';

/** Vowel normalization: Lobanov z-scores per speaker, or the Bark scale (Traunmüller 1990). */
export function normalizeVowels(
  f1: readonly number[],
  f2: readonly number[],
  how: Normalization,
): { x: number[]; y: number[] } {
  if (!f1.length || f1.length !== f2.length) throw new SignalError('vowelTable');
  if ([...f1, ...f2].some((f) => !(f > 0))) throw new SignalError('vowelTable');
  if (how === 'bark') {
    const bark = (f: number) => (26.81 * f) / (1960 + f) - 0.53;
    return { x: f2.map(bark), y: f1.map(bark) };
  }
  if (how === 'lobanov') {
    const z = (v: readonly number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
      return v.map((one) => (s > 0 ? (one - m) / s : 0));
    };
    return { x: z(f2), y: z(f1) };
  }
  return { x: [...f2], y: [...f1] };
}

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** The nearest equal-tempered note to f with A4 at `a4`, and the deviation in cents. */
export function tuner(
  f: number,
  a4 = 440,
): { note: string; midi: number; cents: number; target: number; steps: Step[] } {
  if (!(f > 0) || !Number.isFinite(f)) throw new SignalError('frequency');
  if (!(a4 >= 400 && a4 <= 480)) throw new SignalError('referencePitch');
  const exact = 69 + 12 * Math.log2(f / a4);
  const midi = Math.round(exact);
  const target = a4 * 2 ** ((midi - 69) / 12);
  const cents = 1200 * Math.log2(f / target);
  const note = `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  return {
    note,
    midi,
    cents,
    target,
    steps: [
      step('audioSemitones', `n = 69 + 12·log₂(${fmt(f)}/${fmt(a4)}) = ${fmt(exact)}`),
      step('audioCents', `cents = 1200·log₂(${fmt(f)}/${fmt(target)}) = ${fmt(cents)}`, { note }),
    ],
  };
}

/** Chao tone numbers as a contour: digits 1 to 5, each level 3 semitones apart, 3 at the speaker's mean. */
export function chaoContour(digits: string, points = 50): number[] {
  const levels = [...digits.trim()].map(Number);
  if (!levels.length || levels.length > 4 || levels.some((d) => !(d >= 1 && d <= 5))) throw new SignalError('chao');
  const st = levels.map((d) => (d - 3) * 3);
  if (st.length === 1) return Array<number>(points).fill(st[0]!);
  return Array.from({ length: points }, (_, i) => {
    const u = (i / (points - 1)) * (st.length - 1);
    const k = Math.min(st.length - 2, Math.floor(u));
    return st[k]! + (u - k) * (st[k + 1]! - st[k]!);
  });
}

/** A pitch contour in semitones re its own mean, stretched over `points` from the first to the last voiced frame. */
export function speakerContour(f0: readonly number[], points = 50): number[] {
  const voiced = f0.filter(Number.isFinite);
  if (voiced.length < 3) throw new SignalError('tooFewVoiced');
  const mean = Math.exp(voiced.reduce((a, f) => a + Math.log(f), 0) / voiced.length);
  const st = voiced.map((f) => 12 * Math.log2(f / mean));
  return Array.from({ length: points }, (_, i) => {
    const u = (i / (points - 1)) * (st.length - 1);
    const k = Math.min(st.length - 2, Math.floor(u));
    return st[k]! + (u - k) * (st[k + 1]! - st[k]!);
  });
}

export const rmsDifference = (a: readonly number[], b: readonly number[]): number =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0) / a.length);

/** Pure-tone average: the mean threshold at 500, 1000, and 2000 Hz (and 4000 Hz for the four-frequency average). */
export function pureToneAverage(thresholds: Record<number, number>, withFourK = false): number {
  const at = withFourK ? [500, 1000, 2000, 4000] : [500, 1000, 2000];
  const values = at.map((f) => thresholds[f]);
  if (values.some((v) => v === undefined || !Number.isFinite(v))) throw new SignalError('ptaFrequencies');
  return values.reduce<number>((a, b) => a + b!, 0) / values.length;
}

/** L = 10 log₁₀ Σ 10^(Lᵢ/10). */
export function sumLevels(levels: readonly number[]): { level: number; steps: Step[] } {
  if (!levels.length || levels.some((l) => !Number.isFinite(l))) throw new SignalError('levels');
  const level = 10 * Math.log10(levels.reduce((a, l) => a + 10 ** (l / 10), 0));
  return {
    level,
    steps: [step('audioSum', `L = 10·log₁₀(${levels.map((l) => `10^(${fmt(l)}/10)`).join(' + ')}) = ${fmt(level)} dB`)],
  };
}

/** The level left when a background level is taken away from a total. */
export function subtractLevel(total: number, background: number): number {
  if (!(total > background)) throw new SignalError('levelOrder');
  return 10 * Math.log10(10 ** (total / 10) - 10 ** (background / 10));
}

/** A point source in free field: ΔL = −20 log₁₀(r₂/r₁). */
export function distanceChange(r1: number, r2: number): number {
  if (!(r1 > 0) || !(r2 > 0)) throw new SignalError('distances');
  return -20 * Math.log10(r2 / r1);
}

/** A-weighting by the IEC 61672 analytic formula, in dB. */
export function aWeighting(f: number): number {
  if (!(f > 0)) throw new SignalError('frequency');
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

export interface ToneSpec {
  f0: number;
  harmonics: number;
  /** Each harmonic's amplitude is 1/n^rolloff. */
  rolloff: number;
  duration: number;
  attack: number;
  release: number;
}

/** A tone with harmonics and a linear attack and release, peak-normalized to 0.9. */
export function generateTone(spec: ToneSpec, fs: number): number[] {
  const { f0, harmonics, rolloff, duration, attack, release } = spec;
  if (!(f0 > 0 && f0 < fs / 2)) throw new SignalError('frequency');
  if (!(duration > 0 && duration <= 10)) throw new SignalError('toneDuration');
  if (!Number.isInteger(harmonics) || harmonics < 1 || harmonics > 40) throw new SignalError('harmonics');
  const n = Math.round(duration * fs);
  const out = new Array<number>(n);
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / fs;
    let v = 0;
    for (let h = 1; h <= harmonics && h * f0 < fs / 2; h += 1) v += Math.sin(2 * Math.PI * h * f0 * t) / h ** rolloff;
    const env = Math.min(1, attack > 0 ? t / attack : 1, release > 0 ? (duration - t) / release : 1);
    out[i] = v * Math.max(0, env);
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  return peak > 0 ? out.map((v) => (0.9 * v) / peak) : out;
}
