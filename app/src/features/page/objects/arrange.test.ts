// Z-order targets stay below the ink layer and step past one overlapping neighbor.
import { describe, expect, it } from 'vitest';
import type { BlockJson, PageRect } from '../../../services/pages/types';
import { arrangeTarget, canArrange, frameValue } from './arrange';

function block(id: string, order: string, type = 'text', x = 0): BlockJson {
  return { id, type, order, created: '', modified: '', frame: { x, y: 0 }, data: {} };
}

const rects: Record<string, PageRect> = {
  a: { x: 0, y: 0, w: 100, h: 50 },
  b: { x: 500, y: 0, w: 100, h: 50 },
  c: { x: 50, y: 10, w: 100, h: 50 },
};
const rect = (id: string) => rects[id] ?? null;

describe('arranging blocks', () => {
  const blocks = [block('a', 'a0'), block('b', 'a1'), block('c', 'a2'), block('ink', 'a3', 'ink')];

  it('keeps the front below the ink layer', () => {
    expect(arrangeTarget('bringToFront', 'a', blocks, rect)).toEqual({ after: 'c' });
    expect(arrangeTarget('bringToFront', 'c', blocks, rect)).toBeNull();
    expect(canArrange('bringToFront', 'c', blocks)).toBe(false);
  });

  it('sends a block to the back', () => {
    expect(arrangeTarget('sendToBack', 'c', blocks, rect)).toEqual({ before: 'a' });
    expect(arrangeTarget('sendToBack', 'a', blocks, rect)).toBeNull();
  });

  it('steps forward and backward past the next overlapping block', () => {
    expect(arrangeTarget('bringForward', 'a', blocks, rect)).toEqual({ after: 'c' });
    expect(arrangeTarget('sendBackward', 'c', blocks, rect)).toEqual({ before: 'a' });
  });

  it('rounds frame values to 0.01 units within range', () => {
    expect(frameValue(10.126)).toBe(10.13);
    expect(frameValue(-4)).toBe(0);
    expect(frameValue(90, 120)).toBe(120);
  });
});
