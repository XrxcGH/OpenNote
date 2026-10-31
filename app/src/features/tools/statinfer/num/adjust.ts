// Adjusting a family of p-values for multiple testing: Bonferroni, Holm, Hochberg, Benjamini-Hochberg, and
// Benjamini-Yekutieli. Each returns the adjusted p-values in the input order, capped at 1, and kept in order.
export type Adjustment = 'none' | 'bonferroni' | 'holm' | 'hochberg' | 'bh' | 'by';

export const ADJUSTMENTS: readonly Adjustment[] = ['none', 'bonferroni', 'holm', 'hochberg', 'bh', 'by'];

const order = (p: readonly number[]): number[] => p.map((_, i) => i).sort((a, b) => p[a] - p[b] || a - b);

export function adjust(p: readonly number[], method: Adjustment): number[] {
  const m = p.length;
  const out = new Array<number>(m).fill(Number.NaN);
  if (m === 0) return out;
  if (method === 'none') return [...p];
  if (method === 'bonferroni') return p.map((v) => Math.min(1, v * m));
  const up = order(p);
  if (method === 'holm') {
    let running = 0;
    up.forEach((index, rank) => {
      running = Math.max(running, Math.min(1, (m - rank) * p[index]));
      out[index] = running;
    });
    return out;
  }
  // The step-up methods run from the largest p-value down.
  const harmonic = method === 'by' ? Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0) : 1;
  let running = 1;
  for (let rank = m - 1; rank >= 0; rank -= 1) {
    const index = up[rank];
    const factor = method === 'hochberg' ? m - rank : (m * harmonic) / (rank + 1);
    running = Math.min(running, Math.min(1, factor * p[index]));
    out[index] = running;
  }
  return out;
}
