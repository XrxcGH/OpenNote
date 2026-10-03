import { describe, expect, it } from 'vitest';
import { pageOf, textBlock } from '../testing/build';
import { waveStroke } from '../testing/samples';
import { cropPage } from './crop';
import { selectArea, selectChosen } from './select';

const page = pageOf(
  [
    { ...textBlock('Picked', { x: 100, y: 100, w: 200 }), id: 'picked' },
    { ...textBlock('Left alone', { x: 120, y: 130, w: 200 }), id: 'other' },
    { type: 'ink', data: { role: 'layer' }, frame: { x: 0, y: 0 }, id: 'ink1' },
  ],
  {
    view: { layout: 'freeform' },
    strokes: [
      { ...waveStroke('ink1', 400, 400, 120), id: 'near' },
      { ...waveStroke('ink1', 410, 410, 100), id: 'beside' },
    ],
  },
);
const boxes = new Map([
  ['picked', { x: 100, y: 100, w: 200, h: 30 }],
  ['other', { x: 120, y: 130, w: 200, h: 30 }],
]);

describe('a selection of items already chosen', () => {
  it('takes exactly the chosen blocks and strokes, not what lies in their box', () => {
    const sel = selectChosen(page, { blocks: ['picked'], strokes: ['near'] }, { boxes })!;
    expect(sel.blocks).toEqual(['picked']);
    expect(sel.strokes).toEqual(['near']);
    expect(sel.bounds.x).toBeLessThanOrEqual(100);
    expect(sel.bounds.y + sel.bounds.h).toBeGreaterThan(400);
    // A lasso around the same box would take the neighbors too.
    const wide = selectArea(
      page,
      [
        { x: 90, y: 90 },
        { x: 540, y: 90 },
        { x: 540, y: 440 },
        { x: 90, y: 440 },
      ],
      { boxes },
    )!;
    expect(wide.blocks).toContain('other');
    expect(wide.strokes).toContain('beside');
  });

  it('trims to the content and keeps a crop that holds it with padding', () => {
    const sel = selectChosen(page, { blocks: ['picked'], strokes: [] }, { boxes })!;
    expect(sel.bounds).toEqual({ x: 100, y: 100, w: 200, h: 30 });
    expect(sel.crop.w).toBeGreaterThanOrEqual(200 + 24);
    expect(sel.clip).toBeNull();
  });

  it('feeds the cropped page: only the chosen items are on it', () => {
    const sel = selectChosen(page, { blocks: ['picked'], strokes: ['near'] }, { boxes })!;
    const cropped = cropPage(page, sel, { boxes });
    expect(cropped.blocks.filter((b) => b.type === 'text')).toHaveLength(1);
    expect(cropped.strokes).toHaveLength(1);
  });

  it('answers null when nothing chosen can be placed', () => {
    expect(selectChosen(page, { blocks: [], strokes: [] })).toBeNull();
    expect(selectChosen(page, { blocks: ['nope'], strokes: ['nope'] })).toBeNull();
  });
});
