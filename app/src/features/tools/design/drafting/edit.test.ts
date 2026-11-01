import '../text';
import { describe, expect, it } from 'vitest';
import { addDim, addEntity, alignedOffset, History, pick, refAt, remove, updateEntity } from './edit';
import { dimLines, emptyDoc } from './model';

function withLine() {
  const added = addEntity(emptyDoc(), { k: 'line', a: [0, 0], b: [30, 40], lt: 'visible' });
  if (!added.ok) throw new Error('add');
  return { doc: added.doc, id: added.id };
}

describe('editing a drafting sheet', () => {
  it('a dimension on a drawn line reads 50.00, and follows when an endpoint moves', () => {
    const { doc, id } = withLine();
    const dim = addDim(doc, { k: 'aligned', a: refAt(doc, [0, 0]), b: refAt(doc, [30, 40]), off: 6 });
    if (!dim.ok) throw new Error('dim');
    expect(dimLines(dim.doc)[0]!.text).toBe('50.00');
    const moved = updateEntity(dim.doc, id, { b: [60, 80] });
    expect(dimLines(moved)[0]!.text).toBe('100.00');
  });
  it('one undo restores the geometry and the dimension together', () => {
    const { doc, id } = withLine();
    const dim = addDim(doc, { k: 'aligned', a: refAt(doc, [0, 0]), b: refAt(doc, [30, 40]), off: 6 });
    if (!dim.ok) throw new Error('dim');
    const history = new History(dim.doc);
    history.push(updateEntity(history.present, id, { b: [60, 80] }));
    expect(dimLines(history.present)[0]!.text).toBe('100.00');
    history.undo();
    expect(dimLines(history.present)[0]!.text).toBe('50.00');
    history.redo();
    expect(dimLines(history.present)[0]!.text).toBe('100.00');
  });
  it('a point on a line end becomes a reference that follows; a free point stays a coordinate', () => {
    const { doc } = withLine();
    expect(refAt(doc, [30, 40])).toEqual({ id: 'e1', at: 'b' });
    expect(refAt(doc, [5, 5])).toEqual({ x: 5, y: 5 });
  });
  it('removing a line removes the dimensions and hatching that depend on it', () => {
    const rect = addEntity(emptyDoc(), { k: 'rect', a: [0, 0], b: [20, 10], lt: 'visible' });
    if (!rect.ok) throw new Error('rect');
    const hatch = addEntity(rect.doc, { k: 'hatch', of: rect.id, spacing: 2, angle: 45 });
    if (!hatch.ok) throw new Error('hatch');
    const dim = addDim(hatch.doc, { k: 'aligned', a: refAt(hatch.doc, [0, 0]), b: refAt(hatch.doc, [20, 0]), off: 4 });
    if (!dim.ok) throw new Error('dim');
    const gone = remove(dim.doc, rect.id);
    expect(gone.entities).toEqual([]);
    expect(gone.dims).toEqual([]);
  });
  it('refuses shapes with no size and notes with no text', () => {
    expect(addEntity(emptyDoc(), { k: 'line', a: [1, 1], b: [1, 1], lt: 'visible' })).toEqual({
      ok: false,
      problem: 'tooSmall',
    });
    expect(addEntity(emptyDoc(), { k: 'circle', c: [1, 1], r: 0, lt: 'visible' }).ok).toBe(false);
    expect(addEntity(emptyDoc(), { k: 'note', p: [1, 1], text: '  ' }).ok).toBe(false);
  });
  it('picks the nearest shape within reach of a point', () => {
    const { doc } = withLine();
    expect(pick(doc, [15.1, 20.1], 1)?.id).toBe('e1');
    expect(pick(doc, [50, 5], 1)).toBeNull();
  });
  it('the offset that puts an aligned dimension line through a point has the right sign', () => {
    expect(alignedOffset([0, 0], [10, 0], [5, 7])).toBeCloseTo(7, 9);
    expect(alignedOffset([0, 0], [10, 0], [5, -7])).toBeCloseTo(-7, 9);
  });
  it('an inch drawing reads true size in inches', () => {
    const base = { ...emptyDoc('in'), scale: { drawing: 1, actual: 1 }, decimals: 3 };
    const line = addEntity(base, { k: 'line', a: [0, 0], b: [25.4, 0], lt: 'visible' });
    if (!line.ok) throw new Error('line');
    const dim = addDim(line.doc, { k: 'aligned', a: refAt(line.doc, [0, 0]), b: refAt(line.doc, [25.4, 0]), off: 4 });
    if (!dim.ok) throw new Error('dim');
    expect(dimLines(dim.doc)[0]!.text).toBe('1.000');
  });
  it('drawing at 1:2 reads double the sheet length', () => {
    const base = { ...emptyDoc(), scale: { drawing: 1, actual: 2 } };
    const line = addEntity(base, { k: 'line', a: [0, 0], b: [30, 40], lt: 'visible' });
    if (!line.ok) throw new Error('line');
    const dim = addDim(line.doc, { k: 'aligned', a: refAt(line.doc, [0, 0]), b: refAt(line.doc, [30, 40]), off: 4 });
    if (!dim.ok) throw new Error('dim');
    expect(dimLines(dim.doc)[0]!.text).toBe('100.00');
  });
});
