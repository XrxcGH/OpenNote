// Plots the control tools share: pole and zero maps in the s- or z-plane, root loci from tracked branches, and
// sampled or continuous responses. They are plot specs, drawn by plot.ts like any other.
import type { Locus } from '../lib/locus';
import type { Complex } from '../lib/tf';
import type { PlotSpec, Series } from './plot';

const pts = (zs: readonly Complex[]) => zs.map((z) => [z.re, z.im] as const);

/** Poles as crosses and zeros as rings; the z-plane adds the unit circle. */
export function poleZeroMap(
  id: string,
  poles: readonly Complex[],
  zeros: readonly Complex[],
  plane: 's' | 'z',
): PlotSpec {
  return {
    id,
    x: { label: 'real' },
    y: { label: 'imag' },
    equal: true,
    unitCircle: plane === 'z',
    series: [
      { id: 'poles', style: 'markers', marker: 'x', pen: 1, points: pts(poles) },
      { id: 'zeros', style: 'markers', marker: 'o', pen: 0, points: pts(zeros) },
    ],
  };
}

/** The branches of a root locus, with the open-loop poles and zeros marked. */
export function locusMap(
  id: string,
  locus: Locus,
  poles: readonly Complex[],
  zeros: readonly Complex[],
  plane: 's' | 'z',
  extra: readonly Series[] = [],
): PlotSpec {
  const all = [...locus.branches.flat(), ...poles, ...zeros];
  // Keep the view on the interesting part: branches running off to infinity are clipped at a few times the span of
  // the poles and zeros.
  const span = Math.max(1, ...[...poles, ...zeros].map((z) => Math.hypot(z.re, z.im))) * 3;
  const inView = (z: Complex) => Math.abs(z.re) < span && Math.abs(z.im) < span;
  const xs = all.filter(inView).map((z) => z.re);
  const ys = all.filter(inView).map((z) => z.im);
  return {
    id,
    x: { label: 'real', min: Math.min(-1, ...xs), max: Math.max(plane === 'z' ? 1 : 0.5, ...xs) },
    y: { label: 'imag', min: Math.min(-1, ...ys), max: Math.max(1, ...ys) },
    equal: true,
    unitCircle: plane === 'z',
    series: [
      ...locus.branches.map((b, i) => ({ id: i === 0 ? 'branches' : '', pen: 0, points: pts(b) })),
      { id: 'poles', style: 'markers' as const, marker: 'x' as const, pen: 1, points: pts(poles) },
      { id: 'zeros', style: 'markers' as const, marker: 'o' as const, pen: 1, points: pts(zeros) },
      ...extra,
    ],
  };
}
