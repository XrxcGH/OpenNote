// Confidence intervals for a proportion and for a Poisson count. Clopper-Pearson and Garwood are the exact
// intervals from the beta and chi-square quantiles. Wilson's score interval and the Agresti-Coull interval are the
// approximate ones that introductory courses compare them with.
import { ensure } from '../../errors';
import { betaQuantile, chiSquareQuantile, normalQuantile } from './continuous';

export interface Interval {
  lower: number;
  upper: number;
}

function checkProportion(x: number, n: number, confidence: number): void {
  ensure(Number.isInteger(n) && n >= 1, 'domain', 'n');
  ensure(Number.isInteger(x) && x >= 0 && x <= n, 'domain', 'x');
  ensure(confidence > 0 && confidence < 1, 'domain', 'confidence');
}

/** The exact interval for x successes in n trials: beta quantiles at α/2 and 1 − α/2. */
export function clopperPearson(x: number, n: number, confidence = 0.95): Interval {
  checkProportion(x, n, confidence);
  const alpha = 1 - confidence;
  return {
    lower: x === 0 ? 0 : betaQuantile(alpha / 2, x, n - x + 1),
    upper: x === n ? 1 : betaQuantile(1 - alpha / 2, x + 1, n - x),
  };
}

/** Wilson's score interval: (p̂ + z²/2n ± z √(p̂(1 − p̂)/n + z²/4n²)) / (1 + z²/n). */
export function wilson(x: number, n: number, confidence = 0.95): Interval {
  checkProportion(x, n, confidence);
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = x / n;
  const z2 = z * z;
  const center = p + z2 / (2 * n);
  const half = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lower: Math.max(0, (center - half) / (1 + z2 / n)), upper: Math.min(1, (center + half) / (1 + z2 / n)) };
}

/** Agresti-Coull: add z²/2 successes and z²/2 failures, then the Wald interval, clipped to [0, 1]. */
export function agrestiCoull(x: number, n: number, confidence = 0.95): Interval {
  checkProportion(x, n, confidence);
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const nTilde = n + z * z;
  const p = (x + (z * z) / 2) / nTilde;
  const half = z * Math.sqrt((p * (1 - p)) / nTilde);
  return { lower: Math.max(0, p - half), upper: Math.min(1, p + half) };
}

/** Garwood's exact interval for a Poisson mean from one count x: χ²(α/2; 2x)/2 to χ²(1 − α/2; 2x + 2)/2. */
export function garwood(x: number, confidence = 0.95): Interval {
  ensure(Number.isInteger(x) && x >= 0, 'domain', 'x');
  ensure(confidence > 0 && confidence < 1, 'domain', 'confidence');
  const alpha = 1 - confidence;
  return {
    lower: x === 0 ? 0 : chiSquareQuantile(alpha / 2, 2 * x) / 2,
    upper: chiSquareQuantile(1 - alpha / 2, 2 * x + 2) / 2,
  };
}
