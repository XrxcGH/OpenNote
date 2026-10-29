// Models fitted to a measured step response. First order plus dead time uses the two-point method of Smith: the
// times to 28.3% and 63.2% of the change give τ = 1.5(t₆₃ − t₂₈) and θ = t₆₃ − τ. An underdamped second-order model
// uses the overshoot and peak time: ζ = −ln Mp / √(π² + ln² Mp) and ωₙ = π/(tₚ√(1 − ζ²)).
import { ControlError } from '../lib/errors';
import { step, type Step } from '../lib/steps';
import { fmt } from '../lib/tf';

export interface Data {
  readonly t: number[];
  readonly y: number[];
}

/** Reads "t y" pairs, one to a line (or split by semicolons). */
export function readData(text: string): Data {
  const t: number[] = [];
  const y: number[] = [];
  for (const line of text.split(/[\n;]+/)) {
    const cells = line
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!cells.length) continue;
    const nums = cells.map((c) => Number(c.replace(/−/g, '-')));
    if (cells.length !== 2 || !nums.every(Number.isFinite)) throw new ControlError('dataLine', { line: line.trim() });
    t.push(nums[0]);
    y.push(nums[1]);
  }
  if (t.length < 5) throw new ControlError('dataFew');
  for (let i = 1; i < t.length; i += 1) if (!(t[i] > t[i - 1])) throw new ControlError('dataOrder');
  return { t, y };
}

/** The first time the data reach a level, by linear interpolation; NaN if they never do. */
function timeTo(d: Data, level: number, y0: number, dy: number): number {
  const r = (i: number) => (d.y[i] - y0) / dy;
  for (let i = 1; i < d.t.length; i += 1) {
    if (r(i) >= level) {
      const a = r(i - 1);
      const b = r(i);
      return d.t[i - 1] + ((level - a) / (b - a)) * (d.t[i] - d.t[i - 1]);
    }
  }
  return Number.NaN;
}

export interface Fit {
  readonly gain: number;
  readonly params: Readonly<Record<string, number>>;
  /** The fitted response at the data times. */
  readonly model: number[];
  readonly rms: number;
  readonly steps: Step[];
}

function change(d: Data, du: number): { y0: number; dy: number } {
  if (!Number.isFinite(du) || du === 0) throw new ControlError('stepSize');
  const y0 = d.y[0];
  const dy = d.y[d.y.length - 1] - y0;
  if (Math.abs(dy) < 1e-12 * Math.max(1, Math.abs(y0))) throw new ControlError('dataFlat');
  return { y0, dy };
}

const rmsOf = (a: readonly number[], b: readonly number[]) =>
  Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0) / a.length);

/** First order plus dead time K e^(−θs)/(τs + 1) by the two-point method. */
export function fitFopdt(d: Data, du: number): Fit {
  const { y0, dy } = change(d, du);
  const t28 = timeTo(d, 0.283, y0, dy);
  const t63 = timeTo(d, 0.632, y0, dy);
  if (!Number.isFinite(t28) || !Number.isFinite(t63)) throw new ControlError('dataLevels');
  const tau = 1.5 * (t63 - t28);
  const theta = Math.max(0, t63 - tau - d.t[0]);
  const gain = dy / du;
  const model = d.t.map((t) => {
    const x = t - d.t[0] - theta;
    return y0 + (x > 0 ? dy * (1 - Math.exp(-x / tau)) : 0);
  });
  return {
    gain,
    params: { tau, theta },
    model,
    rms: rmsOf(model, d.y),
    steps: [
      step(
        'ident.change',
        { dy: fmt(dy), du: fmt(du), k: fmt(gain) },
        `K = \\frac{\\Delta y}{\\Delta u} = ${fmt(gain)}`,
      ),
      step('ident.levels', { t28: fmt(t28), t63: fmt(t63) }),
      step(
        'ident.fopdt',
        { tau: fmt(tau), theta: fmt(theta) },
        `\\tau = 1.5(t_{63} - t_{28}) = ${fmt(tau)},\\quad \\theta = t_{63} - \\tau = ${fmt(theta)}`,
      ),
    ],
  };
}

/** An underdamped second-order model K ωₙ²/(s² + 2ζωₙs + ωₙ²) from the overshoot and the peak time. */
export function fitSecondOrder(d: Data, du: number): Fit {
  const { y0, dy } = change(d, du);
  let iMax = 0;
  d.y.forEach((y, i) => {
    if ((y - y0) / dy > (d.y[iMax] - y0) / dy) iMax = i;
  });
  const mp = (d.y[iMax] - y0) / dy - 1;
  if (!(mp > 1e-6) || iMax === d.y.length - 1) throw new ControlError('noOvershoot');
  // A parabola through the three samples around the peak refines its time and height.
  let tp = d.t[iMax];
  let peak = mp;
  if (iMax > 0) {
    const [ta, tb, tc] = [d.t[iMax - 1], d.t[iMax], d.t[iMax + 1]];
    const [ya, yb, yc] = [d.y[iMax - 1], d.y[iMax], d.y[iMax + 1]].map((y) => (y - y0) / dy);
    const den = (ta - tb) * (ta - tc) * (tb - tc);
    const A = (tc * (yb - ya) + tb * (ya - yc) + ta * (yc - yb)) / den;
    const B = (tc * tc * (ya - yb) + tb * tb * (yc - ya) + ta * ta * (yb - yc)) / den;
    if (A < 0) {
      tp = -B / (2 * A);
      peak = yb + A * (tp - tb) ** 2 - 1 + (2 * A * tb + B) * (tp - tb);
    }
  }
  const lnMp = Math.log(peak);
  const zeta = -lnMp / Math.sqrt(Math.PI ** 2 + lnMp ** 2);
  const tpFromStart = tp - d.t[0];
  const wn = Math.PI / (tpFromStart * Math.sqrt(1 - zeta * zeta));
  const gain = dy / du;
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const model = d.t.map((t) => {
    const x = t - d.t[0];
    const r =
      1 - Math.exp(-zeta * wn * x) * (Math.cos(wd * x) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * x));
    return y0 + dy * r;
  });
  return {
    gain,
    params: { zeta, wn, overshoot: 100 * peak, tp: tpFromStart },
    model,
    rms: rmsOf(model, d.y),
    steps: [
      step(
        'ident.change',
        { dy: fmt(dy), du: fmt(du), k: fmt(gain) },
        `K = \\frac{\\Delta y}{\\Delta u} = ${fmt(gain)}`,
      ),
      step('ident.peak', { os: fmt(100 * peak), tp: fmt(tpFromStart) }),
      step('ident.zeta', { zeta: fmt(zeta) }, `\\zeta = \\frac{-\\ln M_p}{\\sqrt{\\pi^2 + \\ln^2 M_p}} = ${fmt(zeta)}`),
      step('ident.wn', { wn: fmt(wn) }, `\\omega_n = \\frac{\\pi}{t_p\\sqrt{1 - \\zeta^2}} = ${fmt(wn)}`),
    ],
  };
}
