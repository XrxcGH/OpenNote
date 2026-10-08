// Review findings on scribble to erase: a highlighter going over words must never erase them, a retraced capital M
// is a letter and not a scribble, and a scribble over a few tiny marks erases nothing.
import { describe, expect, it } from 'vitest';
import { lineStroke } from '../../geometry/fixtures';
import { createStrokeIndex } from '../../geometry/strokeIndex';
import type { InkPoint, Vec } from '../../geometry/types';
import { scribble } from './corpus';
import { detectScribble, scribbleTargets } from './scribble';

/** A path through corners, one point per page unit, over `ms` milliseconds. */
function path(corners: readonly Vec[], ms: number): InkPoint[] {
  const points: Vec[] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k < steps; k++)
      points.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  points.push(corners[corners.length - 1]);
  return points.map((p, i) => ({ ...p, time: (i / (points.length - 1)) * ms }));
}

describe('scribble to erase', () => {
  it('never takes a highlighter, marker, or brush going back and forth for a scribble', () => {
    expect(detectScribble(scribble(1))).not.toBeNull();
    for (const tool of ['highlighter', 'marker', 'brush'] as const)
      expect(detectScribble(scribble(1), { tool })).toBeNull();
    expect(detectScribble(scribble(1), { tool: 'pencil' })).not.toBeNull();
  });

  it('takes a capital M with its first stem retraced for a letter', () => {
    const m = path(
      [
        { x: 0, y: 0 },
        { x: 0, y: 28 },
        { x: 0, y: 0 },
        { x: 7, y: 14 },
        { x: 14, y: 0 },
        { x: 14, y: 28 },
      ],
      1000,
    );
    expect(detectScribble(m)).toBeNull();
  });

  it('erases nothing when only tiny marks lie under a scribble', () => {
    const match = detectScribble(scribble(1, 7, 160, 40))!;
    const dot = lineStroke('dot', { x: 80, y: 20 }, { x: 81, y: 20 }, 2);
    expect(scribbleTargets(createStrokeIndex([dot]), match)).toEqual([]);
    const word = lineStroke('word', { x: 10, y: 20 }, { x: 150, y: 20 }, 40);
    expect(scribbleTargets(createStrokeIndex([dot, word]), match).sort()).toEqual(['dot', 'word']);
  });
});
