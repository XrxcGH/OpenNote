// Schedules of reinforcement applied to a stream of responses, with the cumulative record, and learning curves:
// the exponential and the power law of practice, each with an asymptote, fitted by least squares.
import { nelderMead } from '../kit/num';
import type { Rng } from '../kit/rng';
import { fail } from '../kit/types';

export type Schedule = 'FR' | 'VR' | 'FI' | 'VI';

export interface Reinforced {
  /** Indices of the responses that earned a reinforcer. */
  readonly reinforced: readonly number[];
  /** The ratio or interval each reinforcer needed, in the order they were set. */
  readonly requirements: readonly number[];
}

/**
 * Which responses a schedule reinforces. FR n: every nth response. VR n: a random count with mean n (uniform
 * from 1 to 2n - 1). FI t: the first response at least t seconds after the last reinforcer (or the start). VI t:
 * the same with random intervals with mean t (exponential, as in a constant-probability schedule).
 */
export function applySchedule(times: readonly number[], schedule: Schedule, value: number, rng: Rng): Reinforced {
  if (!(value > 0)) fail('positive', {}, 'value');
  if ((schedule === 'FR' || schedule === 'VR') && !Number.isInteger(value)) fail('whole', { low: 1 }, 'value');
  times.forEach((t, i) => {
    if (i > 0 && t < times[i - 1]) fail('logOrder', { line: i + 1 }, 'responses');
  });
  const reinforced: number[] = [];
  const requirements: number[] = [];
  const draw = () => {
    if (schedule === 'FR' || schedule === 'FI') return value;
    if (schedule === 'VR') return 1 + rng.int(2 * value - 1);
    return -value * Math.log(1 - rng.next());
  };
  let need = draw();
  requirements.push(need);
  let count = 0;
  let since = 0;
  times.forEach((t, i) => {
    count += 1;
    const earned = schedule === 'FR' || schedule === 'VR' ? count >= need : t - since >= need;
    if (earned) {
      reinforced.push(i);
      count = 0;
      since = t;
      need = draw();
      requirements.push(need);
    }
  });
  return { reinforced, requirements: requirements.slice(0, reinforced.length) };
}

/** Responses at a steady rate per minute for a number of seconds, the first one at 60/rate. */
export function steadyStream(rate: number, seconds: number): number[] {
  if (!(rate > 0)) fail('positive', {}, 'rate');
  if (!(seconds > 0)) fail('positive', {}, 'duration');
  const gap = 60 / rate;
  const n = Math.min(20000, Math.floor(seconds / gap + 1e-9));
  return Array.from({ length: n }, (_, i) => (i + 1) * gap);
}

export interface CurveFit {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly sse: number;
  readonly r2: number;
}

export type Curve = 'exponential' | 'power';

/** y = a + b e^(-c t) or y = a + b t^(-c). */
export const curveAt = (curve: Curve, t: number, f: Pick<CurveFit, 'a' | 'b' | 'c'>): number =>
  curve === 'exponential' ? f.a + f.b * Math.exp(-f.c * t) : f.a + f.b * Math.pow(t, -f.c);

/** Least-squares fit by Nelder-Mead, from several starting rates. Trials must be above 0 for the power law. */
export function fitCurve(ts: readonly number[], ys: readonly number[], curve: Curve): CurveFit {
  if (ts.length < 4) fail('fewPoints', { low: 4 }, 'curve');
  if (curve === 'power' && ts.some((t) => !(t > 0))) fail('powerTrials', {}, 'curve');
  const sse = ([a, b, c]: readonly number[]) =>
    ts.reduce((s, t, i) => s + (ys[i] - curveAt(curve, t, { a, b, c })) ** 2, 0);
  const last = ys[ys.length - 1];
  const first = ys[0];
  const span = Math.max(...ts) - Math.min(...ts) || 1;
  const best = [0.1, 0.5, 1, 2]
    .map((k) => {
      const c0 = curve === 'exponential' ? k / span : k;
      const a0 = last;
      const b0 = (first - last) / (curve === 'exponential' ? Math.exp(-c0 * ts[0]) : Math.pow(ts[0], -c0));
      return nelderMead(
        (v) => sse(v),
        [a0, b0, c0],
        [Math.abs(first - last) / 4 + 1e-6, Math.abs(b0) / 4 + 1e-6, c0 / 2],
      );
    })
    .reduce((p, q) => (q.value < p.value ? q : p));
  const [a, b, c] = best.x;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const sst = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  return { a, b, c, sse: best.value, r2: sst === 0 ? 1 : 1 - best.value / sst };
}
