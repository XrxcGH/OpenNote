// Neural and physiological time series: epochs and event-related averages, the canonical fMRI response with design
// matrices and a GLM fit, spike-train statistics, ECG R peaks with heart-rate variability, and 10-20 electrode
// positions for dot maps. Times are in seconds unless a name says otherwise. Pure: no DOM.
import { lgamma } from '../../kits/num/special';
import { SignalError } from '../shared/errors';
import { fmt } from '../shared/num';
import { step } from '../shared/steps';

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sdOf = (v: readonly number[], population = false) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - (population ? 0 : 1)));
};

export interface Epochs {
  /** Times relative to the event. */
  t: number[];
  kept: number[][];
  rejected: number;
  average: number[];
  se: number[];
}

/**
 * Cuts epochs from `pre` before to `post` after each event (sample indices), subtracts the mean of the pre-event
 * baseline, drops epochs whose absolute value passes `reject`, and averages the rest with the standard error.
 */
export function epochAverage(
  x: readonly number[],
  fs: number,
  events: readonly number[],
  pre: number,
  post: number,
  reject: number,
): Epochs {
  if (!(fs > 0)) throw new SignalError('sampleRate');
  if (!(pre >= 0 && post > 0)) throw new SignalError('epochWindow');
  const a = Math.round(pre * fs);
  const b = Math.round(post * fs);
  const kept: number[][] = [];
  let rejected = 0;
  for (const e of events) {
    if (e - a < 0 || e + b >= x.length) continue;
    const seg = x.slice(e - a, e + b + 1);
    const base = a > 0 ? mean(seg.slice(0, a)) : 0;
    const epoch = seg.map((v) => v - base);
    if (Number.isFinite(reject) && reject > 0 && epoch.some((v) => Math.abs(v) > reject)) rejected += 1;
    else kept.push(epoch);
  }
  if (kept.length < 2) throw new SignalError('fewEpochs');
  const n = kept.length;
  const len = kept[0]!.length;
  const average = Array.from({ length: len }, (_, i) => mean(kept.map((k) => k[i]!)));
  const se = Array.from({ length: len }, (_, i) => sdOf(kept.map((k) => k[i]!)) / Math.sqrt(n));
  return { t: Array.from({ length: len }, (_, i) => (i - a) / fs), kept, rejected, average, se };
}

/** The largest (or most negative) value in a window and its latency, and the mean amplitude there. */
export function peakIn(
  t: readonly number[],
  y: readonly number[],
  from: number,
  to: number,
  polarity: 'positive' | 'negative',
) {
  let best = -1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (t[i]! < from || t[i]! > to) continue;
    sum += y[i]!;
    count += 1;
    if (best < 0 || (polarity === 'positive' ? y[i]! > y[best]! : y[i]! < y[best]!)) best = i;
  }
  if (best < 0) throw new SignalError('emptyWindow');
  return { amplitude: y[best]!, latency: t[best]!, meanAmplitude: sum / count };
}

/** Averaging N trials of independent noise shrinks it by √N, so the signal-to-noise ratio grows by √N. */
export const snrGain = (trials: number): number => {
  if (!Number.isInteger(trials) || trials < 1) throw new SignalError('trials');
  return Math.sqrt(trials);
};

/** The gamma density with shape k and scale θ. */
const gammaPdf = (t: number, k: number, theta = 1) =>
  t <= 0 ? 0 : Math.exp((k - 1) * Math.log(t) - t / theta - lgamma(k) - k * Math.log(theta));

/** The canonical double-gamma HRF (SPM defaults): g(t; 6, 1) − g(t; 16, 1)/6. */
export const hrf = (t: number): number => gammaPdf(t, 6) - gammaPdf(t, 16) / 6;

/** The HRF's peak time, by golden-section search between 2 and 10 s. */
export function hrfPeak(): number {
  let lo = 2;
  let hi = 10;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 100; i += 1) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (hrf(a) > hrf(b)) hi = b;
    else lo = a;
  }
  return (lo + hi) / 2;
}

/** A regressor: the stimulus (1 during events or blocks) convolved with the HRF, sampled at each TR. */
export function regressor(
  onsets: readonly number[],
  durations: readonly number[],
  tr: number,
  scans: number,
): number[] {
  if (!(tr > 0) || !Number.isInteger(scans) || scans < 2 || scans > 2000) throw new SignalError('scans');
  const dt = 0.1;
  const length = Math.ceil((scans * tr) / dt);
  const stim = new Float64Array(length);
  onsets.forEach((on, i) => {
    const d = Math.max(dt, durations[i] ?? durations[0] ?? 0);
    for (let k = Math.round(on / dt); k < Math.min(length, Math.round((on + d) / dt)); k += 1) if (k >= 0) stim[k] = 1;
  });
  const kernel = Array.from({ length: Math.ceil(32 / dt) }, (_, k) => hrf(k * dt) * dt);
  return Array.from({ length: scans }, (_, s) => {
    const n = Math.round((s * tr) / dt);
    let total = 0;
    for (let k = 0; k < kernel.length && k <= n; k += 1) total += kernel[k]! * stim[n - k]!;
    return total;
  });
}

/** Solves a small symmetric positive-definite system by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) throw new SignalError('collinear');
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k += 1) m[r]![k] = m[r]![k]! - f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

const inverse = (a: number[][]): number[][] => {
  const n = a.length;
  const columns = Array.from({ length: n }, (_, j) =>
    solve(
      a,
      Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)),
    ),
  );
  return Array.from({ length: n }, (_, i) => columns.map((col) => col[i]!));
};

/** OLS: b = (X'X)⁻¹X'y, residuals, and t = c'b / √(s² c'(X'X)⁻¹c) for a contrast c. */
export function glm(columns: readonly (readonly number[])[], y: readonly number[], contrast: readonly number[]) {
  const p = columns.length;
  const n = y.length;
  if (!p || columns.some((c) => c.length !== n)) throw new SignalError('designShape');
  if (n <= p) throw new SignalError('designShape');
  if (contrast.length !== p) throw new SignalError('contrast', { count: p });
  const xtx = columns.map((a) => columns.map((b) => a.reduce((s, v, i) => s + v * b[i]!, 0)));
  const xty = columns.map((a) => a.reduce((s, v, i) => s + v * y[i]!, 0));
  const beta = solve(xtx, xty);
  const fitted = y.map((_, i) => columns.reduce((s, c, j) => s + c[i]! * beta[j]!, 0));
  const residuals = y.map((v, i) => v - fitted[i]!);
  const s2 = residuals.reduce((s, r) => s + r * r, 0) / (n - p);
  const inv = inverse(xtx);
  const cb = contrast.reduce((s, c, j) => s + c * beta[j]!, 0);
  const cvc = contrast.reduce((s, ci, i) => s + ci * contrast.reduce((t, cj, j) => t + inv[i]![j]! * cj, 0), 0);
  const t = s2 > 0 ? cb / Math.sqrt(s2 * cvc) : cb === 0 ? 0 : Infinity;
  return {
    beta,
    residuals,
    fitted,
    t,
    df: n - p,
    steps: [
      step('neuroGlmBeta', `b = (X′X)⁻¹X′y = [${beta.map((v) => fmt(v, 5)).join(', ')}]`),
      step('neuroGlmT', `t = c′b/√(s²·c′(X′X)⁻¹c) = ${fmt(t, 5)}, df = ${n - p}`),
    ],
  };
}

/** Pearson correlations between design columns, to show collinearity. */
export function correlations(columns: readonly (readonly number[])[]): number[][] {
  return columns.map((a) =>
    columns.map((b) => {
      const ma = mean(a);
      const mb = mean(b);
      let num = 0;
      let da = 0;
      let db = 0;
      a.forEach((v, i) => {
        num += (v - ma) * (b[i]! - mb);
        da += (v - ma) ** 2;
        db += (b[i]! - mb) ** 2;
      });
      return da > 0 && db > 0 ? num / Math.sqrt(da * db) : Number.NaN;
    }),
  );
}

/** Spike-train statistics from spike times (s): rate, ISIs, CV (population SD over the mean ISI), and Fano factor. */
export function spikeStats(trials: readonly (readonly number[])[], window: number, bin: number) {
  if (!trials.length || trials.every((t) => !t.length)) throw new SignalError('noSpikes');
  if (!(window > 0) || !(bin > 0 && bin <= window)) throw new SignalError('bins');
  const isis = trials.flatMap((t) => t.slice(1).map((s, i) => s - t[i]!));
  if (isis.some((d) => d < 0)) throw new SignalError('spikeOrder');
  const meanIsi = isis.length ? mean(isis) : Number.NaN;
  const cv = isis.length > 1 ? sdOf(isis, true) / meanIsi : Number.NaN;
  const counts = trials.map((t) => t.filter((s) => s >= 0 && s < window).length);
  const fano = counts.length > 1 ? sdOf(counts) ** 2 / mean(counts) : Number.NaN;
  const bins = Math.ceil(window / bin);
  const psth = Array.from({ length: bins }, (_, k) => {
    const n = trials.reduce((a, t) => a + t.filter((s) => s >= k * bin && s < (k + 1) * bin).length, 0);
    return n / trials.length / bin;
  });
  return {
    rate: 1 / meanIsi,
    meanIsi,
    cv,
    fano,
    isis,
    psth,
    centers: psth.map((_, k) => (k + 0.5) * bin),
    steps: [
      step('neuroIsi', `mean ISI = ${fmt(meanIsi * 1000, 5)} ms; rate = 1/mean ISI = ${fmt(1 / meanIsi, 5)} spikes/s`),
      step('neuroCv', `CV = SD/mean = ${fmt(cv, 6)}`),
    ],
  };
}

/** A firing rate smoothed by a Gaussian kernel of width σ (s), summed over trials and divided by their number. */
export function kernelRate(
  trials: readonly (readonly number[])[],
  window: number,
  sigma: number,
  points = 200,
): { t: number[]; rate: number[] } {
  if (!(sigma > 0)) throw new SignalError('positive', { field: 'σ' });
  const t = Array.from({ length: points }, (_, i) => (i / (points - 1)) * window);
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));
  return {
    t,
    rate: t.map(
      (u) =>
        trials.reduce(
          (a, tr) => a + tr.reduce((b, s) => b + norm * Math.exp(-((u - s) ** 2) / (2 * sigma * sigma)), 0),
          0,
        ) / trials.length,
    ),
  };
}

/** Heart-rate variability from RR intervals in ms: mean HR, SDNN, RMSSD, and pNN50. */
export function hrv(rr: readonly number[]) {
  if (rr.length < 3 || rr.some((v) => !(v > 200 && v < 3000))) throw new SignalError('rrIntervals');
  const diffs = rr.slice(1).map((v, i) => v - rr[i]!);
  const sdnn = sdOf(rr);
  const rmssd = Math.sqrt(mean(diffs.map((d) => d * d)));
  const pnn50 = (100 * diffs.filter((d) => Math.abs(d) > 50).length) / diffs.length;
  const hr = 60000 / mean(rr);
  return {
    hr,
    sdnn,
    rmssd,
    pnn50,
    steps: [
      step('neuroHr', `HR = 60000/mean RR = 60000/${fmt(mean(rr))} = ${fmt(hr)} bpm`),
      step('neuroSdnn', `SDNN = ${fmt(sdnn)} ms (sample SD)`),
      step('neuroRmssd', `RMSSD = √mean(ΔRR²) = ${fmt(rmssd)} ms; pNN50 = ${fmt(pnn50)}%`),
    ],
  };
}

/** Lomb-Scargle power of unevenly sampled RR intervals, and the LF (0.04–0.15 Hz) and HF (0.15–0.4 Hz) powers. */
export function lombScargle(times: readonly number[], values: readonly number[], fmax = 0.5, points = 200) {
  const m = mean(values);
  const y = values.map((v) => v - m);
  const f = Array.from({ length: points }, (_, i) => 0.01 + (i / (points - 1)) * (fmax - 0.01));
  const power = f.map((freq) => {
    const w = 2 * Math.PI * freq;
    let s2 = 0;
    let c2 = 0;
    for (const t of times) {
      s2 += Math.sin(2 * w * t);
      c2 += Math.cos(2 * w * t);
    }
    const tau = Math.atan2(s2, c2) / (2 * w);
    let yc = 0;
    let ys = 0;
    let cc = 0;
    let ss = 0;
    times.forEach((t, i) => {
      const c = Math.cos(w * (t - tau));
      const s = Math.sin(w * (t - tau));
      yc += y[i]! * c;
      ys += y[i]! * s;
      cc += c * c;
      ss += s * s;
    });
    return 0.5 * ((yc * yc) / cc + (ys * ys) / ss);
  });
  const band = (lo: number, hi: number) => f.reduce((a, freq, i) => a + (freq >= lo && freq < hi ? power[i]! : 0), 0);
  return { f, power, lf: band(0.04, 0.15), hf: band(0.15, 0.4) };
}

/**
 * R peaks in an ECG by a simplified Pan-Tompkins: a 5–15 Hz band from differences of moving averages, the squared
 * derivative, a 150 ms moving-window integral, and an adaptive threshold with a 200 ms refractory period.
 */
export function rPeaks(ecg: readonly number[], fs: number): number[] {
  if (!(fs >= 100)) throw new SignalError('ecgRate');
  if (ecg.length < fs * 2) throw new SignalError('tooShort');
  const avg = (x: readonly number[], n: number) => {
    const out = new Array<number>(x.length).fill(0);
    let s = 0;
    for (let i = 0; i < x.length; i += 1) {
      s += x[i]! - (i >= n ? x[i - n]! : 0);
      out[i] = s / Math.min(n, i + 1);
    }
    return out;
  };
  const low = avg(ecg, Math.max(1, Math.round(fs / 30)));
  const high = avg(ecg, Math.max(2, Math.round(fs / 5)));
  const band = low.map((v, i) => v - high[i]!);
  const sq = band.map((v, i) => (i > 0 ? (v - band[i - 1]!) ** 2 : 0));
  const integ = avg(sq, Math.round(0.15 * fs));
  const peaks: number[] = [];
  let level = Math.max(...integ.slice(0, Math.round(2 * fs))) * 0.5;
  const refractory = Math.round(0.2 * fs);
  for (let i = 1; i < integ.length - 1; i += 1) {
    if (integ[i]! > level && integ[i]! >= integ[i - 1]! && integ[i]! >= integ[i + 1]!) {
      if (peaks.length && i - peaks.at(-1)! < refractory) continue;
      // The R peak is the largest raw sample in the 150 ms before the integrator's peak.
      let best = i;
      for (let k = Math.max(0, i - Math.round(0.15 * fs)); k <= i; k += 1) if (ecg[k]! > ecg[best]!) best = k;
      if (!peaks.length || best - peaks.at(-1)! >= refractory) peaks.push(best);
      level = 0.7 * level + 0.3 * 0.5 * integ[i]!;
    }
  }
  return peaks;
}

/**
 * 10-20 electrode positions on a flat head (nose up), radius 1 at the 10% ring, after Jasper (1958). The modern
 * (10-10) names T7, T8, P7 and P8 sit where the 1958 names T3, T4, T5 and T6 do, so both are accepted.
 */
export const ELECTRODES: Readonly<Record<string, readonly [number, number]>> = (() => {
  const polar = (r: number, deg: number): [number, number] => [
    r * Math.sin((deg * Math.PI) / 180),
    r * Math.cos((deg * Math.PI) / 180),
  ];
  return {
    Fp1: polar(0.8, -18),
    Fp2: polar(0.8, 18),
    F7: polar(0.8, -54),
    F8: polar(0.8, 54),
    T3: polar(0.8, -90),
    T4: polar(0.8, 90),
    T5: polar(0.8, -126),
    T6: polar(0.8, 126),
    T7: polar(0.8, -90),
    T8: polar(0.8, 90),
    P7: polar(0.8, -126),
    P8: polar(0.8, 126),
    O1: polar(0.8, -162),
    O2: polar(0.8, 162),
    Fz: polar(0.4, 0),
    Cz: [0, 0],
    Pz: polar(0.4, 180),
    C3: polar(0.4, -90),
    C4: polar(0.4, 90),
    F3: polar(0.53, -40),
    F4: polar(0.53, 40),
    P3: polar(0.53, -140),
    P4: polar(0.53, 140),
    Fpz: polar(0.8, 0),
    Oz: polar(0.8, 180),
  };
})();
