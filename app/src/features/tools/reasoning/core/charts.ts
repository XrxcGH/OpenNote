// Time pictures: Gantt bars for schedules and projects, and timing diagrams for logic signals.
import { el, label, round, svgRoot, textWidth } from './svg';
import type { SvgNode, Tone } from './svg';

export interface Bar {
  row: string;
  start: number;
  end: number;
  label?: string;
  tone?: Tone;
}

const SOFT: Partial<Record<Tone, Tone>> = { accent: 'accentSoft', hi: 'hiSoft', warn: 'warnSoft' };

/** Bars on a time axis, one row per name, in the order the rows first appear. */
export function ganttFigure(bars: readonly Bar[], unit = ''): SvgNode {
  const rows = [...new Set(bars.map((b) => b.row))];
  const end = Math.max(1, ...bars.map((b) => b.end));
  const left = Math.max(40, ...rows.map((r) => textWidth(r) + 16));
  const scale = Math.max(8, Math.min(40, 520 / end));
  const width = left + end * scale + 30;
  const height = rows.length * 30 + 50;
  const ticks = tickValues(end);
  const axis = ticks.flatMap((v) => [
    el('line', {
      x1: round(left + v * scale),
      y1: 10,
      x2: round(left + v * scale),
      y2: height - 32,
      stroke: '@line',
      strokeDasharray: '2 3',
    }),
    label(left + v * scale, height - 22, String(v), { fontSize: 11, fill: '@muted' }),
  ]);
  const shapes = bars.flatMap((b) => {
    const y = 14 + rows.indexOf(b.row) * 30;
    const tone = b.tone ?? 'accent';
    const w = Math.max(1, (b.end - b.start) * scale);
    return [
      el('rect', {
        x: round(left + b.start * scale),
        y,
        width: round(w),
        height: 22,
        rx: 3,
        fill: `@${SOFT[tone] ?? 'sunken'}`,
        stroke: `@${tone}`,
      }),
      b.label && textWidth(b.label, 11) < w
        ? label(left + b.start * scale + w / 2, y + 11, b.label, { fontSize: 11 })
        : null,
    ];
  });
  const names = rows.map((r, i) => label(8, 25 + i * 30, r, { textAnchor: 'start' }));
  return svgRoot(
    width,
    height,
    ...axis,
    ...shapes,
    ...names,
    unit ? label(width - 14, height - 8, unit, { fontSize: 11, fill: '@muted', textAnchor: 'end' }) : null,
  );
}

/** Up to about 12 round tick values from 0 to `end`. */
export function tickValues(end: number): number[] {
  const raw = end / 10;
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= end + 1e-9; v += step) ticks.push(round(v));
  return ticks;
}

export interface Signal {
  name: string;
  /** The level in each time step: 0, 1, or null when unknown. */
  levels: readonly (0 | 1 | null)[];
}

/** A timing diagram: one trace per signal, with its level in each time step. */
export function timingFigure(signals: readonly Signal[]): SvgNode {
  const steps = Math.max(1, ...signals.map((s) => s.levels.length));
  const left = Math.max(40, ...signals.map((s) => textWidth(s.name) + 16));
  const w = Math.max(10, Math.min(36, 520 / steps));
  const height = signals.length * 36 + 36;
  const traces = signals.flatMap((s, i) => {
    const top = 12 + i * 36;
    const yOf = (v: 0 | 1 | null) => (v === 1 ? top : v === 0 ? top + 20 : top + 10);
    let d = '';
    s.levels.forEach((v, t) => {
      const x = left + t * w;
      d += t === 0 ? `M${round(x)} ${yOf(v)}` : `L${round(x)} ${yOf(v)}`;
      d += `L${round(x + w)} ${yOf(v)}`;
    });
    return [
      label(8, top + 10, s.name, { textAnchor: 'start' }),
      el('path', { d, fill: 'none', stroke: '@accent', strokeWidth: 2 }),
    ];
  });
  const grid = Array.from({ length: steps + 1 }, (_, t) => [
    el('line', {
      x1: round(left + t * w),
      y1: 6,
      x2: round(left + t * w),
      y2: height - 26,
      stroke: '@line',
      strokeDasharray: '2 4',
    }),
    t % Math.max(1, Math.ceil(steps / 20)) === 0
      ? label(left + t * w, height - 14, String(t), { fontSize: 10, fill: '@muted' })
      : null,
  ]).flat();
  return svgRoot(left + steps * w + 20, height, ...grid, ...traces);
}
