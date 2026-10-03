// Editable shapes: the handles a snapped shape shows, and what dragging one does. A shape is stored as an ordinary stroke
// of exact points, so its handles come from reading those points back with the recognizer. Each handle stands for one
// number of the shape (a corner, a radius, an end), and dragging it changes just that, keeping the rest.

import { distance } from '../primitives';
import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { sampleArc } from './generate';
import type { Shape } from './types';

export interface Handle {
  /** Names the number this handle stands for, such as `c2` or `radius`. */
  readonly id: string;
  readonly at: Vec;
}

const unit = (from: Vec, to: Vec): Vec => {
  const length = distance(from, to) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};
const angleOf = (center: Vec, p: Vec) => Math.atan2(p.y - center.y, p.x - center.x);
const at = (center: Vec, radius: number, angle: number): Vec => ({
  x: center.x + radius * Math.cos(angle),
  y: center.y + radius * Math.sin(angle),
});

function turnBetween(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** The rectangle's own turn, and its half sizes along its sides. */
function rectangleFrame(corners: readonly Vec[]) {
  const rotation = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
  return { rotation, halfW: distance(corners[0], corners[1]) / 2, halfH: distance(corners[1], corners[2]) / 2 };
}

function rectangleFrom(origin: Vec, rotation: number, a: number, b: number): Shape {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const world = (u: number, v: number): Vec => ({ x: origin.x + u * cos - v * sin, y: origin.y + u * sin + v * cos });
  return {
    kind: 'rectangle',
    corners: [world(0, 0), world(a, 0), world(a, b), world(0, b)],
    square: false,
  };
}

/** The handles of a shape: where to draw them. */
export function handlesOf(shape: Shape): Handle[] {
  switch (shape.kind) {
    case 'line':
      return [
        { id: 'from', at: shape.from },
        { id: 'to', at: shape.to },
      ];
    case 'arrow':
      return [
        { id: 'from', at: shape.from },
        { id: 'to', at: shape.tip },
      ];
    case 'doubleArrow':
      return [
        { id: 'from', at: shape.from },
        { id: 'to', at: shape.to },
      ];
    case 'rectangle':
    case 'triangle':
      return shape.corners.map((corner, i) => ({ id: `c${i}`, at: corner }));
    case 'circle':
      return [{ id: 'radius', at: { x: shape.center.x + shape.radius, y: shape.center.y } }];
    case 'ellipse': {
      const cos = Math.cos(shape.rotation);
      const sin = Math.sin(shape.rotation);
      return [
        { id: 'rx', at: { x: shape.center.x + shape.rx * cos, y: shape.center.y + shape.rx * sin } },
        { id: 'ry', at: { x: shape.center.x - shape.ry * sin, y: shape.center.y + shape.ry * cos } },
      ];
    }
    case 'polygon':
      return [{ id: 'radius', at: at(shape.center, shape.radius, shape.rotation) }];
    case 'star':
      return [
        { id: 'outer', at: at(shape.center, shape.outer, shape.rotation) },
        { id: 'inner', at: at(shape.center, shape.inner, shape.rotation + Math.PI / shape.points) },
      ];
    case 'arc':
    case 'curvedArrow':
      return [
        { id: 'start', at: at(shape.center, shape.radius, shape.start) },
        { id: 'end', at: at(shape.center, shape.radius, shape.start + shape.sweep) },
      ];
  }
}

function arrowOf(from: Vec, tip: Vec, length: number): Shape {
  return { kind: 'arrow', from, tip, barbs: headBarbs(tip, unit(from, tip), length) };
}

/** The shape after a handle is dragged to a page point. An unknown handle changes nothing. */
export function dragHandle(shape: Shape, id: string, to: Vec): Shape {
  switch (shape.kind) {
    case 'line':
      return id === 'from' ? { ...shape, from: to } : id === 'to' ? { ...shape, to } : shape;
    case 'arrow': {
      const head = distance(shape.tip, shape.barbs[0]);
      if (id === 'from') return arrowOf(to, shape.tip, head);
      return id === 'to' ? arrowOf(shape.from, to, head) : shape;
    }
    case 'doubleArrow': {
      const head = distance(shape.to, shape.barbsTo[0]);
      const from = id === 'from' ? to : shape.from;
      const end = id === 'to' ? to : shape.to;
      if (id !== 'from' && id !== 'to') return shape;
      return {
        kind: 'doubleArrow',
        from,
        to: end,
        barbsFrom: headBarbs(from, unit(end, from), head),
        barbsTo: headBarbs(end, unit(from, end), head),
      };
    }
    case 'rectangle': {
      const index = Number(id.slice(1));
      if (!id.startsWith('c') || !(index >= 0 && index < 4)) return shape;
      const { rotation } = rectangleFrame(shape.corners);
      const opposite = shape.corners[(index + 2) % 4];
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const dx = to.x - opposite.x;
      const dy = to.y - opposite.y;
      const a = dx * cos + dy * sin;
      const b = -dx * sin + dy * cos;
      // The dragged corner can cross over its opposite; the rectangle then flips and keeps its own side lengths.
      const origin = { x: opposite.x, y: opposite.y };
      const near = rectangleFrom(origin, rotation, a, b);
      return near.kind === 'rectangle' ? { ...near, corners: orderCorners(near.corners) } : near;
    }
    case 'triangle': {
      const index = Number(id.slice(1));
      if (!id.startsWith('c') || !(index >= 0 && index < 3)) return shape;
      const corners = shape.corners.map((corner, i) => (i === index ? to : corner)) as unknown as typeof shape.corners;
      return { ...shape, corners, variant: 'general' };
    }
    case 'circle':
      return id === 'radius' ? { ...shape, radius: Math.max(1, distance(shape.center, to)) } : shape;
    case 'ellipse': {
      const cos = Math.cos(shape.rotation);
      const sin = Math.sin(shape.rotation);
      const dx = to.x - shape.center.x;
      const dy = to.y - shape.center.y;
      if (id === 'rx') return { ...shape, rx: Math.max(1, Math.abs(dx * cos + dy * sin)) };
      if (id === 'ry') return { ...shape, ry: Math.max(1, Math.abs(-dx * sin + dy * cos)) };
      return shape;
    }
    case 'polygon':
      return id === 'radius'
        ? { ...shape, radius: Math.max(1, distance(shape.center, to)), rotation: angleOf(shape.center, to) }
        : shape;
    case 'star': {
      if (id === 'outer') {
        const outer = Math.max(2, distance(shape.center, to));
        return { ...shape, outer, inner: Math.min(shape.inner, outer * 0.9), rotation: angleOf(shape.center, to) };
      }
      if (id === 'inner')
        return { ...shape, inner: Math.min(shape.outer * 0.95, Math.max(1, distance(shape.center, to))) };
      return shape;
    }
    case 'arc':
    case 'curvedArrow': {
      if (id !== 'start' && id !== 'end') return shape;
      const end = shape.start + shape.sweep;
      const angle = angleOf(shape.center, to);
      const next =
        id === 'start'
          ? { start: angle, sweep: end - angle - 2 * Math.PI * Math.round((end - angle - shape.sweep) / (2 * Math.PI)) }
          : { start: shape.start, sweep: shape.sweep + turnBetween(end, angle) };
      if (shape.kind === 'arc') return { ...shape, ...next };
      const body = sampleArc(shape.center, shape.radius, next.start, next.sweep);
      const tip = body[body.length - 1];
      const back = body[Math.max(0, body.length - 4)];
      const head = distance(shape.barbs[0], at(shape.center, shape.radius, shape.start + shape.sweep));
      return { ...shape, ...next, barbs: headBarbs(tip, unit(back, tip), head || 24) };
    }
  }
}

/** Corners in order around the rectangle, whichever way it was dragged. */
function orderCorners(corners: readonly Vec[]): [Vec, Vec, Vec, Vec] {
  const cross =
    (corners[1].x - corners[0].x) * (corners[2].y - corners[1].y) -
    (corners[1].y - corners[0].y) * (corners[2].x - corners[1].x);
  const list = cross < 0 ? [corners[0], corners[3], corners[2], corners[1]] : [...corners];
  return [list[0], list[1], list[2], list[3]];
}
