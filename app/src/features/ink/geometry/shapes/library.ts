// Shape libraries: basic shapes, flowchart symbols, network pieces, and entity diagram symbols. Each is a few polylines
// of exact points, sized to a box and centered on a page point, so inserting one adds ordinary shape strokes. The basic
// ones are the shapes the recognizer reads back, so they keep their handles; the rest are drawn outlines.

import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { polygonCorners, sampleArc, sampleEllipse, shapePoints, starCorners } from './generate';
import type { Shape } from './types';

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

/** The polylines of a library shape, centered on `center` and about `size` wide and `size` times `aspect` tall. */
export function libraryShape(id: string, center: Vec, size: number): Vec[][] {
  const w = size;
  const h = size * 0.62;
  const line = (shape: Shape): Vec[][] => [shapePoints(shape)];
  switch (id) {
    case 'line':
      return line({
        kind: 'line',
        from: { x: center.x - w / 2, y: center.y },
        to: { x: center.x + w / 2, y: center.y },
      });
    case 'arrow': {
      const from = { x: center.x - w / 2, y: center.y };
      const tip = { x: center.x + w / 2, y: center.y };
      return line({ kind: 'arrow', from, tip, barbs: headBarbs(tip, { x: 1, y: 0 }, 22) });
    }
    case 'doubleArrow': {
      const from = { x: center.x - w / 2, y: center.y };
      const to = { x: center.x + w / 2, y: center.y };
      return line({
        kind: 'doubleArrow',
        from,
        to,
        barbsFrom: headBarbs(from, { x: -1, y: 0 }, 22),
        barbsTo: headBarbs(to, { x: 1, y: 0 }, 22),
      });
    }
    case 'curvedArrow': {
      const radius = w * 0.45;
      const body = sampleArc({ x: center.x, y: center.y + radius * 0.4 }, radius, Math.PI * 1.1, Math.PI * 0.8);
      const tip = body[body.length - 1];
      const back = body[body.length - 4];
      const direction = { x: tip.x - back.x, y: tip.y - back.y };
      const length = Math.hypot(direction.x, direction.y) || 1;
      return line({
        kind: 'curvedArrow',
        center: { x: center.x, y: center.y + radius * 0.4 },
        radius,
        start: Math.PI * 1.1,
        sweep: Math.PI * 0.8,
        barbs: headBarbs(tip, { x: direction.x / length, y: direction.y / length }, 22),
      });
    }
    case 'rectangle':
    case 'process':
    case 'entity':
      return [rect(center, w, h)];
    case 'weakEntity':
      return [rect(center, w, h), rect(center, w - 14, h - 14)];
    case 'circle':
      return line({ kind: 'circle', center, radius: h / 2 + 6 });
    case 'ellipse':
    case 'attribute':
      return line({ kind: 'ellipse', center, rx: w / 2, ry: h / 2, rotation: 0 });
    case 'triangle':
      return line({
        kind: 'triangle',
        corners: [
          { x: center.x, y: center.y - h / 2 },
          { x: center.x + w / 2, y: center.y + h / 2 },
          { x: center.x - w / 2, y: center.y + h / 2 },
        ],
        variant: 'general',
      });
    case 'pentagon':
      return [polygonCorners(center, h / 2 + 8, 5, -Math.PI / 2)];
    case 'hexagon':
      return [polygonCorners(center, h / 2 + 8, 6, 0)];
    case 'star':
      return [starCorners(center, h / 2 + 10, (h / 2 + 10) * 0.42, 5, -Math.PI / 2)];
    case 'decision':
    case 'relationship':
      return [diamond(center, w, h * 1.1)];
    case 'terminator':
      return [roundedRect(center, w, h * 0.7, h)];
    case 'data': {
      const skew = h * 0.35;
      return [
        [
          { x: center.x - w / 2 + skew, y: center.y - h / 2 },
          { x: center.x + w / 2 + skew, y: center.y - h / 2 },
          { x: center.x + w / 2 - skew, y: center.y + h / 2 },
          { x: center.x - w / 2 - skew, y: center.y + h / 2 },
          { x: center.x - w / 2 + skew, y: center.y - h / 2 },
        ],
      ];
    }
    case 'document': {
      // The bottom edge is a wave, drawn from the right corner back to the left.
      const wave = Array.from({ length: 25 }, (_, i) => {
        const t = i / 24;
        return { x: center.x + w / 2 - t * w, y: center.y + h / 2 - 4 + Math.sin(t * Math.PI * 2) * 5 };
      });
      return [
        [
          { x: center.x - w / 2, y: wave[24].y },
          { x: center.x - w / 2, y: center.y - h / 2 },
          { x: center.x + w / 2, y: center.y - h / 2 },
          ...wave,
        ],
      ];
    }
    case 'database': {
      const rx = w / 2;
      const ry = h / 5;
      const top = center.y - h / 2 + ry;
      const bottom = center.y + h / 2 - ry;
      return [
        sampleEllipse({ x: center.x, y: top }, rx, ry, 0),
        [
          { x: center.x - rx, y: top },
          { x: center.x - rx, y: bottom },
          ...sampleArc({ x: center.x, y: bottom }, rx, Math.PI, -Math.PI).map((p) => ({
            x: p.x,
            y: bottom + (p.y - bottom) * (ry / rx),
          })),
          { x: center.x + rx, y: top },
        ],
      ];
    }
    case 'cloud': {
      const bumps = 7;
      const points: Vec[] = [];
      for (let i = 0; i < bumps; i++) {
        const a0 = (i / bumps) * Math.PI * 2;
        const a1 = ((i + 1) / bumps) * Math.PI * 2;
        const from = { x: center.x + (w / 2) * Math.cos(a0), y: center.y + (h / 2) * Math.sin(a0) };
        const to = { x: center.x + (w / 2) * Math.cos(a1), y: center.y + (h / 2) * Math.sin(a1) };
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const out = { x: mid.x - center.x, y: mid.y - center.y };
        const push = 0.28;
        const middle = { x: mid.x + out.x * push, y: mid.y + out.y * push };
        points.push(from, ...quadratic(from, middle, to, 8));
      }
      points.push(points[0]);
      return [points];
    }
    case 'server':
      return [
        rect(center, w * 0.6, h * 1.2),
        [
          { x: center.x - w * 0.3, y: center.y - h * 0.2 },
          { x: center.x + w * 0.3, y: center.y - h * 0.2 },
        ],
        [
          { x: center.x - w * 0.3, y: center.y + h * 0.2 },
          { x: center.x + w * 0.3, y: center.y + h * 0.2 },
        ],
      ];
    case 'router':
      return [
        polygonCorners(center, h / 2 + 10, 6, 0),
        [
          { x: center.x - h * 0.3, y: center.y },
          { x: center.x + h * 0.3, y: center.y },
        ],
        [
          { x: center.x, y: center.y - h * 0.3 },
          { x: center.x, y: center.y + h * 0.3 },
        ],
      ];
    default:
      return [];
  }
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
