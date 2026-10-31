// Pictures for cloning: a virtual agarose gel and a plasmid or linear map with features and cut sites.
import type { Figure, Label, Shape } from '../figure';

export interface GelLane {
  label: Label;
  /** Each band's position down the gel from 0 (the well) to 1 (the far end), and the words beside it. */
  bands: { at: number; label?: string }[];
}

/** A gel with one lane per entry; the first lane's band labels sit on the left, the others' on the right. */
export function gelFigure(lanes: readonly GelLane[]): Figure {
  const laneW = 70;
  const left = 70;
  const top = 34;
  const depth = 300;
  const width = left + laneW * lanes.length + 80;
  const shapes: Shape[] = [
    {
      kind: 'rect',
      x: left - 10,
      y: top - 14,
      w: laneW * lanes.length + 20,
      h: depth + 28,
      r: 4,
      stroke: 'faint',
      fill: 'none',
    },
  ];
  lanes.forEach((lane, i) => {
    const x = left + i * laneW + 10;
    shapes.push({ kind: 'text', x: x + 25, y: 14, label: lane.label, size: 11, anchor: 'middle' });
    shapes.push({ kind: 'rect', x, y: top - 8, w: 50, h: 6, stroke: 'muted', fill: 'none', width: 1 });
    for (const band of lane.bands) {
      const y = top + Math.min(1, Math.max(0, band.at)) * depth;
      shapes.push({ kind: 'rect', x, y: y - 2, w: 50, h: 4, r: 1, stroke: 'none', fill: i === 0 ? 'ink' : 'accent' });
      if (band.label) {
        shapes.push(
          i === 0
            ? { kind: 'text', x: x - 6, y: y + 4, label: band.label, size: 10, anchor: 'end', tone: 'muted' }
            : { kind: 'text', x: x + 56, y: y + 4, label: band.label, size: 10, tone: 'muted' },
        );
      }
    }
  });
  return { width, height: top + depth + 24, shapes };
}

export interface MapFeature {
  name: string;
  from: number;
  to: number;
}

export interface MapSite {
  label: string;
  at: number;
}

const point = (cx: number, cy: number, r: number, angle: number): [number, number] => [
  cx + r * Math.cos(angle),
  cy + r * Math.sin(angle),
];

/** A circular map: the backbone, a position scale, features as arcs, and sites as ticks with their labels. */
export function circularMap(length: number, features: readonly MapFeature[], sites: readonly MapSite[]): Figure {
  const size = 440;
  const cx = size / 2;
  const cy = size / 2;
  const r = 130;
  const angle = (pos: number) => (2 * Math.PI * pos) / length - Math.PI / 2;
  const shapes: Shape[] = [
    { kind: 'circle', cx, cy, r, stroke: 'ink', width: 2, fill: 'none' },
    { kind: 'text', x: cx, y: cy + 5, label: `${length} bp`, size: 14, anchor: 'middle', bold: true },
  ];
  const step = niceStep(length);
  for (let pos = 0; pos < length; pos += step) {
    const [x1, y1] = point(cx, cy, r - 4, angle(pos));
    const [x2, y2] = point(cx, cy, r - 10, angle(pos));
    shapes.push({ kind: 'line', x1, y1, x2, y2, stroke: 'faint', width: 1 });
    const [tx, ty] = point(cx, cy, r - 22, angle(pos));
    shapes.push({
      kind: 'text',
      x: tx,
      y: ty + 3,
      label: String(pos === 0 ? 1 : pos),
      size: 9,
      anchor: 'middle',
      tone: 'muted',
    });
  }
  for (const f of features) {
    const span = (f.to - f.from + length) % length || length;
    const a1 = angle(f.from - 1);
    const a2 = angle(f.from - 1 + span);
    const [x1, y1] = point(cx, cy, r, a1);
    const [x2, y2] = point(cx, cy, r, a2);
    shapes.push({
      kind: 'path',
      d: `M${x1} ${y1} A${r} ${r} 0 ${span > length / 2 ? 1 : 0} 1 ${x2} ${y2}`,
      stroke: 'accent',
      width: 9,
    });
    const mid = angle(f.from - 1 + span / 2);
    const [lx, ly] = point(cx, cy, r - 40, mid);
    shapes.push({ kind: 'text', x: lx, y: ly + 4, label: f.name, size: 11, anchor: 'middle', bold: true });
  }
  sites.forEach((s, i) => {
    const a = angle(s.at);
    const reach = r + 14 + (i % 3) * 14;
    const [x1, y1] = point(cx, cy, r + 2, a);
    const [x2, y2] = point(cx, cy, reach, a);
    shapes.push({ kind: 'line', x1, y1, x2, y2, stroke: 'ink', width: 1 });
    const [tx, ty] = point(cx, cy, reach + 4, a);
    shapes.push({
      kind: 'text',
      x: tx,
      y: ty + 4,
      label: s.label,
      size: 10,
      anchor: Math.cos(a) >= 0 ? 'start' : 'end',
    });
  });
  return { width: size, height: size, shapes };
}

/** A linear map: a ruler, features as boxes above it, and sites as ticks below with slanted labels. */
export function linearMap(length: number, features: readonly MapFeature[], sites: readonly MapSite[]): Figure {
  const width = 560;
  const left = 30;
  const span = width - 2 * left;
  const y = 70;
  const x = (pos: number) => left + (pos / length) * span;
  const shapes: Shape[] = [{ kind: 'line', x1: x(0), y1: y, x2: x(length), y2: y, stroke: 'ink', width: 2 }];
  const step = niceStep(length);
  for (let pos = 0; pos <= length; pos += step) {
    shapes.push({ kind: 'line', x1: x(pos), y1: y, x2: x(pos), y2: y + 5, stroke: 'faint', width: 1 });
    shapes.push({
      kind: 'text',
      x: x(pos),
      y: y + 16,
      label: String(pos === 0 ? 1 : pos),
      size: 9,
      anchor: 'middle',
      tone: 'muted',
    });
  }
  for (const f of features) {
    shapes.push({
      kind: 'rect',
      x: x(f.from - 1),
      y: y - 20,
      w: Math.max(2, x(f.to) - x(f.from - 1)),
      h: 12,
      stroke: 'none',
      fill: 'accent',
    });
    shapes.push({
      kind: 'text',
      x: (x(f.from - 1) + x(f.to)) / 2,
      y: y - 26,
      label: f.name,
      size: 11,
      anchor: 'middle',
      bold: true,
    });
  }
  for (const s of sites) {
    shapes.push({ kind: 'line', x1: x(s.at), y1: y + 20, x2: x(s.at), y2: y + 30, stroke: 'ink', width: 1 });
    shapes.push({ kind: 'text', x: x(s.at), y: y + 40, label: s.label, size: 10, rotate: 40 });
  }
  return { width, height: 170, shapes };
}

/** A round step giving about 8 ticks along a sequence. */
export function niceStep(length: number): number {
  const raw = Math.max(1, length / 8);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * power >= raw) ?? 10;
  return unit * power;
}
