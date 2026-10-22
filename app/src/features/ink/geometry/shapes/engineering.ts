// Engineering pieces for the shape library: statics symbols (supports, a force, a moment, a distributed load, and a
// spring) and circuit symbols. Each is a few exact polylines in page units with y down, sized to a box like the
// other library shapes, so once inserted it is ordinary ink that can be moved, turned, resized, and recolored.
import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { sampleArc } from './generate';

type Builder = (c: Vec, w: number, h: number) => Vec[][];

const line = (x1: number, y1: number, x2: number, y2: number): Vec[] => [
  { x: x1, y: y1 },
  { x: x2, y: y2 },
];

/** A shaft and its head, ending at (x2, y2). */
function arrow(x1: number, y1: number, x2: number, y2: number, head: number): Vec[][] {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [left, right] = headBarbs({ x: x2, y: y2 }, { x: (x2 - x1) / length, y: (y2 - y1) / length }, head);
  return [line(x1, y1, x2, y2), [left, { x: x2, y: y2 }, right]];
}

/** Short slanted strokes under a ground line from x1 to x2 at y: the hatching of a fixed surface. */
function hatch(x1: number, x2: number, y: number, size: number): Vec[][] {
  const out: Vec[][] = [line(x1, y, x2, y)];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const x = x1 + ((i + 0.5) / count) * (x2 - x1);
    out.push(line(x, y, x - size, y + size));
  }
  return out;
}

const pinSupport: Builder = (c, w, h) => {
  const top = c.y - h / 2;
  const base = c.y + h * 0.15;
  return [
    [
      { x: c.x, y: top },
      { x: c.x + w * 0.25, y: base },
      { x: c.x - w * 0.25, y: base },
      { x: c.x, y: top },
    ],
    ...hatch(c.x - w * 0.4, c.x + w * 0.4, base, h * 0.25),
  ];
};

const rollerSupport: Builder = (c, w, h) => {
  const top = c.y - h / 2;
  const base = c.y;
  const r = h * 0.12;
  return [
    [
      { x: c.x, y: top },
      { x: c.x + w * 0.22, y: base },
      { x: c.x - w * 0.22, y: base },
      { x: c.x, y: top },
    ],
    sampleArc({ x: c.x - w * 0.11, y: base + r }, r, 0, Math.PI * 2),
    sampleArc({ x: c.x + w * 0.11, y: base + r }, r, 0, Math.PI * 2),
    ...hatch(c.x - w * 0.4, c.x + w * 0.4, base + 2 * r, h * 0.2),
  ];
};

/** A wall on the left: the bar meets it at the wall line. */
const fixedSupport: Builder = (c, w, h) => {
  const x = c.x - w * 0.1;
  const out: Vec[][] = [line(x, c.y - h / 2, x, c.y + h / 2)];
  for (let i = 0; i < 5; i++) {
    const y = c.y - h / 2 + ((i + 0.5) / 5) * h;
    out.push(line(x, y, x - h * 0.22, y + h * 0.22));
  }
  out.push(line(x, c.y, c.x + w / 2, c.y));
  return out;
};

const forceArrow: Builder = (c, _w, h) => arrow(c.x, c.y - h / 2, c.x, c.y + h / 2, 20);

const momentArrow: Builder = (c, _w, h) => {
  const r = h * 0.45;
  const start = Math.PI * 0.15;
  const sweep = -Math.PI * 1.5;
  const body = sampleArc(c, r, start, sweep);
  const tip = body[body.length - 1];
  const back = body[body.length - 3];
  const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
  const [left, right] = headBarbs(tip, { x: (tip.x - back.x) / length, y: (tip.y - back.y) / length }, 18);
  return [body, [left, tip, right], sampleArc(c, 3, 0, Math.PI * 2)];
};

const distributedLoad: Builder = (c, w, h) => {
  const top = c.y - h / 2;
  const bottom = c.y + h / 2;
  const out: Vec[][] = [line(c.x - w / 2, top, c.x + w / 2, top)];
  for (let i = 0; i <= 4; i++)
    out.push(...arrow(c.x - w / 2 + (i * w) / 4, top, c.x - w / 2 + (i * w) / 4, bottom, 12));
  return out;
};

const spring: Builder = (c, w, h) => {
  const coils = 6;
  const left = c.x - w / 2;
  const start = left + w * 0.2;
  const end = c.x + w / 2 - w * 0.2;
  const points: Vec[] = [
    { x: left, y: c.y },
    { x: start, y: c.y },
  ];
  for (let i = 0; i < coils; i++) {
    const x = start + ((i + 0.5) / coils) * (end - start);
    points.push({ x, y: c.y + (i % 2 === 0 ? -h * 0.3 : h * 0.3) });
  }
  points.push({ x: end, y: c.y }, { x: c.x + w / 2, y: c.y });
  return [points];
};

export const MECHANICS_SHAPES = [
  'pinSupport',
  'rollerSupport',
  'fixedSupport',
  'forceArrow',
  'momentArrow',
  'distributedLoad',
  'spring',
] as const;

export const ENGINEERING_BUILDERS: Readonly<Record<string, Builder>> = {
  pinSupport,
  rollerSupport,
  fixedSupport,
  forceArrow,
  momentArrow,
  distributedLoad,
  spring,
};
