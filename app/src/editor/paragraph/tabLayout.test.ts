// Known answers for tab stops (text DESIGN.md 7.2), worked by hand from Word's rules. Default stops are every 36
// points. A tab exactly at a stop goes on to the next. A set stop wins over the default ones before it.
import { describe, expect, it } from 'vitest';
import type { TabStop } from './attributes';
import { borderPlaces } from './borders';
import { parseTextBlock } from '../markdown/parse';
import { decimalAt, effectiveStops, nextStop, tabWidth } from './tabLayout';

const none = { width: 0, beforeDecimal: 0 };
const end = (x: number, stops: TabStop[] = [], following = none) => {
  const stop = nextStop(x, effectiveStops([], stops));
  return x + tabWidth(x, stop, following);
};

describe('tab stops', () => {
  it('ends a tab at 10 pt at the default stop at 36 pt', () => {
    expect(end(10)).toBe(36);
  });

  it('moves a tab at exactly 36 pt on to 72 pt', () => {
    expect(end(36)).toBe(72);
  });

  it('uses the page default interval', () => {
    expect(nextStop(10, [], 72).pos).toBe(72);
  });

  it('goes to a set stop before the default ones, and to default stops after the last set stop', () => {
    const stops: TabStop[] = [{ pos: 100, align: 'start', leader: 'dot' }];
    expect(nextStop(10, effectiveStops([], stops))).toEqual({ pos: 100, align: 'start', leader: 'dot' });
    expect(end(120, stops)).toBe(144);
  });

  it('centers, ends, and aligns the decimal sign of the text after the tab at its stop', () => {
    const at = (align: TabStop['align']) => [{ pos: 144, align, leader: 'none' } as TabStop];
    const following = { width: 40, beforeDecimal: 25 };
    expect(end(20, at('center'), following) + 20).toBe(144);
    expect(end(20, at('end'), following) + 40).toBe(144);
    expect(end(20, at('decimal'), following) + 25).toBe(144);
  });

  it('leaves a tab empty when the text after it is too wide for its stop', () => {
    expect(end(130, [{ pos: 144, align: 'end', leader: 'none' }], { width: 40, beforeDecimal: 40 })).toBe(130);
  });

  it('clears a stop the style sets, and never moves text to a bar stop', () => {
    const style: TabStop[] = [
      { pos: 72, align: 'start', leader: 'none' },
      { pos: 90, align: 'bar', leader: 'none' },
    ];
    expect(effectiveStops(style, [{ pos: 72, align: 'clear', leader: 'none' }])).toEqual([]);
    expect(effectiveStops(style).map((stop) => stop.pos)).toEqual([72]);
  });
});

describe('border groups', () => {
  it('joins neighbors with equal borders and indents into one box', () => {
    const box = { border: { top: { style: 'single', width: 0.5, space: 1, color: null } } };
    const other = { border: { top: { style: 'double', width: 0.5, space: 1, color: null } } };
    expect(borderPlaces([box, box, box, other, null, box])).toEqual([
      'first',
      'middle',
      'last',
      'single',
      null,
      'single',
    ]);
    expect(borderPlaces([box, { ...box, indent: { start: 18, end: 0, first: 0 } }])).toEqual(['single', 'single']);
  });
});

describe('finding the decimal sign', () => {
  it('counts a hard break before the sign at its size in the document', () => {
    // a=1, b=2, the hard break=3, c=4, d=5, so the '.' is at 6. A text walk that drops the break would say 5.
    const doc = parseTextBlock('ab\\\ncd.e');
    expect(doc.firstChild!.child(1).type.name).toBe('hardBreak');
    expect(decimalAt(doc, 1, doc.firstChild!.nodeSize - 1)).toBe(6);
    expect(decimalAt(doc, 1, 6)).toBe(-1);
  });
});
