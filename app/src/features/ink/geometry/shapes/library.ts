// Shape libraries: basic shapes, flowchart symbols, network pieces, and entity diagram symbols. Each is a few polylines
// of exact points, sized to a box and centered on a page point, so inserting one adds ordinary shape strokes. The basic
// ones are the shapes the recognizer reads back, so they keep their handles; the rest are drawn outlines.

import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { polygonCorners, sampleArc, sampleEllipse, shapePoints, starCorners } from './generate';

export type LibraryGroup = 'basic' | 'flowchart' | 'network' | 'entity';

export interface LibraryItem {
  readonly id: string;
  readonly group: LibraryGroup;
}

export const LIBRARY: readonly LibraryItem[] = [
  ...(
    [
      'line',
      'arrow',
      'doubleArrow',
      'curvedArrow',
      'rectangle',
      'circle',
      'ellipse',
      'triangle',
      'pentagon',
      'hexagon',
      'star',
    ] as const
  ).map((id) => ({ id, group: 'basic' as const })),
  ...(['process', 'decision', 'terminator', 'data', 'document'] as const).map((id) => ({
    id,
    group: 'flowchart' as const,
  })),
  ...(['database', 'cloud', 'server', 'router'] as const).map((id) => ({ id, group: 'network' as const })),
  ...(['entity', 'weakEntity', 'relationship', 'attribute'] as const).map((id) => ({ id, group: 'entity' as const })),
];

const rect = (c: Vec, w: number, h: number): Vec[] => {
  const [l, r, t, b] = [c.x - w / 2, c.x + w / 2, c.y - h / 2, c.y + h / 2];
  return [
    { x: l, y: t },
    { x: r, y: t },
    { x: r, y: b },
    { x: l, y: b },
    { x: l, y: t },
  ];
};

/** A rectangle with round corners, closing on its first point. */
function roundedRect(c: Vec, w: number, h: number, radius: number): Vec[] {
  const r = Math.min(radius, w / 2, h / 2);
  const [l, rt, t, b] = [c.x - w / 2, c.x + w / 2, c.y - h / 2, c.y + h / 2];
  const corner = (cx: number, cy: number, start: number) => sampleArc({ x: cx, y: cy }, r, start, Math.PI / 2);
  const first = corner(rt - r, t + r, -Math.PI / 2);
  return [
    ...first,
    ...corner(rt - r, b - r, 0),
    ...corner(l + r, b - r, Math.PI / 2),
    ...corner(l + r, t + r, Math.PI),
    first[0],
  ];
}

const diamond = (c: Vec, w: number, h: number): Vec[] => [
  { x: c.x, y: c.y - h / 2 },
  { x: c.x + w / 2, y: c.y },
  { x: c.x, y: c.y + h / 2 },
  { x: c.x - w / 2, y: c.y },
  { x: c.x, y: c.y - h / 2 },
];

type Builder = (c: Vec, w: number, h: number) => Vec[][];

const alongX = (c: Vec, w: number): [Vec, Vec] => [
  { x: c.x - w / 2, y: c.y },
  { x: c.x + w / 2, y: c.y },
];

const arrow: Builder = (c, w) => {
  const [from, tip] = alongX(c, w);
  return [shapePoints({ kind: 'arrow', from, tip, barbs: headBarbs(tip, { x: 1, y: 0 }, 22) })];
};

const doubleArrow: Builder = (c, w) => {
  const [from, to] = alongX(c, w);
  const barbsFrom = headBarbs(from, { x: -1, y: 0 }, 22);
  const barbsTo = headBarbs(to, { x: 1, y: 0 }, 22);
  return [shapePoints({ kind: 'doubleArrow', from, to, barbsFrom, barbsTo })];
};

const curvedArrow: Builder = (c, w) => {
  const radius = w * 0.45;
  const center = { x: c.x, y: c.y + radius * 0.4 };
  const body = sampleArc(center, radius, Math.PI * 1.1, Math.PI * 0.8);
  const tip = body[body.length - 1];
  const back = body[body.length - 4];
  const length = Math.hypot(tip.x - back.x, tip.y - back.y) || 1;
  const direction = { x: (tip.x - back.x) / length, y: (tip.y - back.y) / length };
  const barbs = headBarbs(tip, direction, 22);
  return [shapePoints({ kind: 'curvedArrow', center, radius, start: Math.PI * 1.1, sweep: Math.PI * 0.8, barbs })];
};

const triangle: Builder = (c, w, h) => [
  shapePoints({
    kind: 'triangle',
    corners: [
      { x: c.x, y: c.y - h / 2 },
      { x: c.x + w / 2, y: c.y + h / 2 },
      { x: c.x - w / 2, y: c.y + h / 2 },
    ],
    variant: 'general',
  }),
];

const parallelogram: Builder = (c, w, h) => {
  const skew = h * 0.35;
  return [
    [
      { x: c.x - w / 2 + skew, y: c.y - h / 2 },
      { x: c.x + w / 2 + skew, y: c.y - h / 2 },
      { x: c.x + w / 2 - skew, y: c.y + h / 2 },
      { x: c.x - w / 2 - skew, y: c.y + h / 2 },
      { x: c.x - w / 2 + skew, y: c.y - h / 2 },
    ],
  ];
};

/** A page with a wave for its bottom edge, drawn from the right corner back to the left. */
const documentPage: Builder = (c, w, h) => {
  const wave = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return { x: c.x + w / 2 - t * w, y: c.y + h / 2 - 4 + Math.sin(t * Math.PI * 2) * 5 };
  });
  const left = c.x - w / 2;
  return [[{ x: left, y: wave[24].y }, { x: left, y: c.y - h / 2 }, { x: c.x + w / 2, y: c.y - h / 2 }, ...wave]];
};

/** A can: the top ellipse, and the sides with a rounded bottom. */
const database: Builder = (c, w, h) => {
  const rx = w / 2;
  const ry = h / 5;
  const top = c.y - h / 2 + ry;
  const bottom = c.y + h / 2 - ry;
  const belly = sampleArc({ x: c.x, y: bottom }, rx, Math.PI, -Math.PI).map((p) => ({
    x: p.x,
    y: bottom + (p.y - bottom) * (ry / rx),
  }));
  return [
    sampleEllipse({ x: c.x, y: top }, rx, ry, 0),
    [{ x: c.x - rx, y: top }, { x: c.x - rx, y: bottom }, ...belly, { x: c.x + rx, y: top }],
  ];
};

/** A cloud: seven bumps around an ellipse, each a curve pushed outward. */
const cloud: Builder = (c, w, h) => {
  const bumps = 7;
  const points: Vec[] = [];
  for (let i = 0; i < bumps; i++) {
    const a0 = (i / bumps) * Math.PI * 2;
    const a1 = ((i + 1) / bumps) * Math.PI * 2;
    const from = { x: c.x + (w / 2) * Math.cos(a0), y: c.y + (h / 2) * Math.sin(a0) };
    const to = { x: c.x + (w / 2) * Math.cos(a1), y: c.y + (h / 2) * Math.sin(a1) };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const middle = { x: mid.x + (mid.x - c.x) * 0.28, y: mid.y + (mid.y - c.y) * 0.28 };
    points.push(from, ...quadratic(from, middle, to, 8));
  }
  points.push(points[0]);
  return [points];
};

const server: Builder = (c, w, h) => {
  const half = w * 0.3;
  const bar = (y: number): Vec[] => [
    { x: c.x - half, y },
    { x: c.x + half, y },
  ];
  return [rect(c, w * 0.6, h * 1.2), bar(c.y - h * 0.2), bar(c.y + h * 0.2)];
};

const router: Builder = (c, _w, h) => [
  polygonCorners(c, h / 2 + 10, 6, 0),
  [
    { x: c.x - h * 0.3, y: c.y },
    { x: c.x + h * 0.3, y: c.y },
  ],
  [
    { x: c.x, y: c.y - h * 0.3 },
    { x: c.x, y: c.y + h * 0.3 },
  ],
];

const BUILDERS: Readonly<Record<string, Builder>> = {
  line: (c, w) => [alongX(c, w)],
  arrow,
  doubleArrow,
  curvedArrow,
  rectangle: (c, w, h) => [rect(c, w, h)],
  process: (c, w, h) => [rect(c, w, h)],
  entity: (c, w, h) => [rect(c, w, h)],
  weakEntity: (c, w, h) => [rect(c, w, h), rect(c, w - 14, h - 14)],
  circle: (c, _w, h) => [shapePoints({ kind: 'circle', center: c, radius: h / 2 + 6 })],
  ellipse: (c, w, h) => [shapePoints({ kind: 'ellipse', center: c, rx: w / 2, ry: h / 2, rotation: 0 })],
  attribute: (c, w, h) => [shapePoints({ kind: 'ellipse', center: c, rx: w / 2, ry: h / 2, rotation: 0 })],
  triangle,
  pentagon: (c, _w, h) => [polygonCorners(c, h / 2 + 8, 5, -Math.PI / 2)],
  hexagon: (c, _w, h) => [polygonCorners(c, h / 2 + 8, 6, 0)],
  star: (c, _w, h) => [starCorners(c, h / 2 + 10, (h / 2 + 10) * 0.42, 5, -Math.PI / 2)],
  decision: (c, w, h) => [diamond(c, w, h * 1.1)],
  relationship: (c, w, h) => [diamond(c, w, h * 1.1)],
  terminator: (c, w, h) => [roundedRect(c, w, h * 0.7, h)],
  data: parallelogram,
  document: documentPage,
  database,
  cloud,
  server,
  router,
};

/** The polylines of a library shape, centered on `center` and about `size` wide and 0.62 times that tall. */
export function libraryShape(id: string, center: Vec, size: number): Vec[][] {
  return BUILDERS[id]?.(center, size, size * 0.62) ?? [];
}

function quadratic(a: Vec, control: Vec, b: Vec, steps: number): Vec[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    };
  });
}
