// Krogh's tissue cylinder: one capillary of radius rc supplies a coaxial cylinder of tissue of radius R that uses
// oxygen at a uniform rate M. Steady diffusion with K = Dα gives the Krogh-Erlang profile
//   P(r) = Pc + M/(4K) (r² − rc²) − M R²/(2K) ln(r / rc),
// lowest at the cylinder's edge. Along the capillary the blood gives up that oxygen, so the capillary PO₂ falls from
// the arterial to the venous end, and the venous end's edge is the "lethal corner". Radii in µm, M in mL O₂ per
// 100 mL of tissue per minute, D in cm²/s, α in mL O₂/(mL·mmHg), capillary speed in mm/s, length in mm.
import { LsError, positive } from '../num/errors';
import { brent } from '../num/roots';
import type { CalcResult, ResultRow, Series, Step } from '../types';
import { severinghaus } from './respiratory';

type Point = [number, number];

/** The Krogh-Erlang PO₂ (mmHg) at radius r, all lengths in cm, m in mL O₂/(mL·s), k = Dα. */
export function kroghP(pc: number, m: number, k: number, rc: number, big: number, r: number): number {
  return pc + (m / (4 * k)) * (r * r - rc * rc) - ((m * big * big) / (2 * k)) * Math.log(r / rc);
}

/** Blood O₂ content in mL O₂ per dL: bound to hemoglobin (Severinghaus) plus dissolved. */
export const bloodContent = (p: number, hb: number): number => 1.34 * hb * severinghaus(p) + 0.003 * p;

/** The PO₂ that gives a blood content c (mL/dL), or 0 when the blood is empty. */
export function po2ForContent(c: number, hb: number): number {
  if (c <= 0) return 0;
  return brent((p) => bloodContent(p, hb) - c, 0, 2000);
}

export interface KroghInput {
  pc: number;
  rcUm: number;
  rUm: number;
  /** mL O₂ / (100 mL tissue · min). */
  m: number;
  d: number;
  alpha: number;
  /** Optional: hemoglobin (g/dL), capillary speed (mm/s), and length (mm) for the fall along the capillary. */
  hb: number | null;
  speed: number | null;
  length: number | null;
}

export function kroghResult(input: KroghInput): CalcResult {
  const { pc, rcUm, rUm, m: m100, d, alpha } = input;
  positive(pc, 'Pc');
  positive(rcUm, 'rc');
  positive(rUm, 'R');
  positive(m100, 'M');
  positive(d, 'D');
  positive(alpha, 'α');
  if (!(rUm > rcUm)) throw new LsError('physiology.e.krogh');
  const axial = [input.hb, input.speed, input.length];
  if (axial.some((x) => x !== null) && axial.some((x) => x === null)) throw new LsError('physiology.e.kroghAxial');
  const m = m100 / 6000;
  const k = d * alpha;
  const rc = rcUm * 1e-4;
  const big = rUm * 1e-4;
  const edge = (p: number, radius = big) => kroghP(p, m, k, rc, radius, radius);
  // The largest cylinder this capillary PO₂ keeps above 0 at its edge (P at the edge falls as R grows).
  const critical = brent((x) => edge(pc, x * 1e-4), rcUm * (1 + 1e-9), bracketHigh(pc, m, k, rc));
  const rows: ResultRow[] = [
    { label: 'physiology.r.kroghEdge', value: edge(pc), unit: 'mmHg' },
    { label: 'physiology.r.kroghDrop', value: pc - edge(pc), unit: 'mmHg' },
    { label: 'physiology.r.kroghCritical', value: critical, unit: 'µm' },
  ];
  const steps: Step[] = [
    { key: 'physiology.s.kroghUnits', vars: { m100, m, d, alpha, k } },
    {
      key: 'physiology.s.krogh',
      vars: { pc, a: m / (4 * k), b: (m * big * big) / (2 * k), rc: rcUm, R: rUm, p: edge(pc) },
      math: 'P(r) = P_c + \\frac{M}{4K}(r^2 - r_c^2) - \\frac{M R^2}{2K}\\ln\\frac{r}{r_c}',
    },
    { key: 'physiology.s.kroghCritical', vars: { pc, r: critical } },
  ];
  const profile = (p: number): Point[] =>
    Array.from({ length: 81 }, (_, i) => {
      const r = rc + ((big - rc) * i) / 80;
      return [r * 1e4, Math.max(0, kroghP(p, m, k, rc, big, r))] as Point;
    });
  const series: Series[] = [{ name: 'physiology.p.kroghArterial', points: profile(pc) }];
  const plots: NonNullable<CalcResult['plots']> = [];
  if (input.hb !== null && input.speed !== null && input.length !== null) {
    const hb = positive(input.hb, 'Hb');
    const speed = positive(input.speed, 'v');
    const length = positive(input.length, 'L');
    // O₂ the tissue takes per cm of capillary, over the blood flow π rc² v: content falls linearly with distance.
    const perCm = (m * (big * big - rc * rc)) / (rc * rc * (speed / 10)); // mL O₂ per mL blood per cm
    const c0 = bloodContent(pc, hb);
    const c1 = c0 - perCm * 100 * (length / 10);
    const pv = po2ForContent(c1, hb);
    const corner = edge(pv);
    rows.push(
      { label: 'physiology.r.kroghContent', value: c0, unit: 'mL/dL' },
      { label: 'physiology.r.kroghVenousContent', value: Math.max(0, c1), unit: 'mL/dL' },
      { label: 'physiology.r.kroghVenous', value: pv, unit: 'mmHg' },
      { label: 'physiology.r.kroghCorner', value: corner, unit: 'mmHg' },
    );
    steps.push(
      { key: 'physiology.s.kroghAxial', vars: { k: perCm * 100, L: length, c0, c1: Math.max(0, c1) } },
      { key: c1 > 0 ? 'physiology.s.kroghVenous' : 'physiology.s.kroghEmpty', vars: { p: pv, e: corner } },
    );
    if (corner <= 0) steps.push({ key: 'physiology.s.kroghAnoxic' });
    series.push({ name: 'physiology.p.kroghVenous', points: profile(pv) });
    plots.push({
      title: 'physiology.p.kroghAxial',
      x: { label: 'physiology.p.distance', min: 0 },
      y: { label: 'physiology.p.po2', min: 0 },
      series: [
        {
          name: 'physiology.p.kroghCapillary',
          points: Array.from({ length: 61 }, (_, i) => {
            const x = (length * i) / 60;
            return [x, po2ForContent(c0 - perCm * 100 * (x / 10), hb)] as Point;
          }),
        },
        {
          name: 'physiology.p.kroghEdgeSeries',
          style: 'dashed',
          points: Array.from({ length: 61 }, (_, i) => {
            const x = (length * i) / 60;
            return [x, Math.max(0, edge(po2ForContent(c0 - perCm * 100 * (x / 10), hb)))] as Point;
          }),
        },
      ],
    });
  }
  plots.unshift({
    title: 'physiology.p.kroghRadial',
    x: { label: 'physiology.p.radiusUm', min: 0 },
    y: { label: 'physiology.p.po2', min: 0 },
    series: series.map((s, i) => (i === 0 ? s : { ...s, style: 'dashed' as const })),
  });
  return {
    rows,
    steps,
    latex: 'P(r) = P_c + \\frac{M}{4K}(r^2 - r_c^2) - \\frac{M R^2}{2K}\\ln\\frac{r}{r_c}',
    notes: [{ key: 'physiology.n.krogh' }],
    source: 'physiology.src.krogh',
    plots,
  };
}

/** A radius in µm where the edge PO₂ is below 0, to bracket the critical radius. */
function bracketHigh(pc: number, m: number, k: number, rc: number): number {
  let x = rc * 1e4 * 2;
  while (kroghP(pc, m, k, rc, x * 1e-4, x * 1e-4) > 0) {
    x *= 2;
    if (x > 1e9) throw new LsError('physiology.e.krogh');
  }
  return x;
}
