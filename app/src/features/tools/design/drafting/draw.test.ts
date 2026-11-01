import '../text';
import { describe, expect, it } from 'vitest';
import { bearing, drawDoc, sheetSize, toSvg } from './draw';
import type { PathPrim, TextPrim, TitleLabels } from './draw';
import { emptyDoc } from './model';
import type { Dim, DraftingDoc, Entity } from './model';

const LABELS: TitleLabels = {
  title: 'Title',
  drawnBy: 'Drawn by',
  date: 'Date',
  scale: 'Scale',
  sheet: 'Sheet',
  material: 'Material',
  tolerance: 'Tolerances unless otherwise specified',
};

function doc(entities: Entity[], dims: Dim[] = [], patch: Partial<DraftingDoc> = {}): DraftingDoc {
  return { ...emptyDoc('mm'), entities, dims, ...patch };
}
const texts = (d: DraftingDoc) => drawDoc(d, LABELS).filter((p): p is TextPrim => p.t === 'text');
const paths = (d: DraftingDoc) => drawDoc(d, LABELS).filter((p): p is PathPrim => p.t === 'path');

describe('drawing primitives', () => {
  const line: Entity = { id: 'l1', k: 'line', a: [10, 10], b: [40, 50], lt: 'visible' };
  const dim: Dim = { id: 'd1', k: 'aligned', a: { id: 'l1', at: 'a' }, b: { id: 'l1', at: 'b' }, off: 6 };

  it('writes the live dimension text', () => {
    expect(texts(doc([line], [dim])).map((t) => t.text)).toContain('50.00');
    expect(texts(doc([line], [dim], { scale: { drawing: 1, actual: 2 } })).map((t) => t.text)).toContain('100.00');
  });

  it('flips y so the sheet reads the right way up', () => {
    const { h } = sheetSize(doc([]));
    const p = paths(doc([line])).find((x) => x.owner === 'l1')!;
    expect(p.d).toBe(`M10 ${h - 10}L40 ${h - 50}`);
  });

  it("uses each line type's weight and dashes", () => {
    const d = doc([
      { ...line, id: 'a', lt: 'visible' },
      { ...line, id: 'b', lt: 'hidden' },
      { ...line, id: 'c', lt: 'center' },
    ]);
    const by = Object.fromEntries(
      paths(d)
        .filter((p) => p.owner)
        .map((p) => [p.owner!, p]),
    );
    expect(by.a).toMatchObject({ weight: 0.6, dash: [] });
    expect(by.b).toMatchObject({ weight: 0.3, dash: [3, 1.5] });
    expect(by.c).toMatchObject({ weight: 0.3, dash: [18, 3, 3, 3] });
  });

  it('dimension text reads upright whatever the direction', () => {
    const steep: Dim = { id: 'd2', k: 'aligned', a: { x: 0, y: 0 }, b: { x: -10, y: -30 }, off: 4 };
    for (const t of texts(doc([], [steep]))) {
      expect(t.angle).toBeGreaterThan(-90 - 1e-9);
      expect(t.angle).toBeLessThanOrEqual(90);
    }
    const down: Dim = { id: 'd3', k: 'aligned', a: { x: 0, y: 0 }, b: { x: -20, y: 0 }, off: 4 };
    expect(texts(doc([], [down])).find((t) => t.text === '20.00')!.angle).toBe(0);
  });

  it('draws arrowheads, extension lines and a dimension line for an aligned dimension', () => {
    const own = paths(doc([line], [dim])).filter((p) => p.owner === 'd1');
    expect(own.filter((p) => p.fill === 'ink')).toHaveLength(2);
    expect(own.filter((p) => p.fill === 'none')).toHaveLength(3);
  });

  it('draws circles, arcs, rectangles, polylines, hatching and notes', () => {
    const d = doc([
      { id: 'c', k: 'circle', c: [50, 50], r: 10, lt: 'visible' },
      { id: 'r', k: 'rect', a: [0, 0], b: [20, 20], lt: 'visible' },
      {
        id: 'p',
        k: 'poly',
        pts: [
          [0, 0],
          [5, 5],
          [10, 0],
        ],
        closed: true,
        lt: 'hidden',
      },
      { id: 'a', k: 'arc', c: [60, 60], r: 5, a0: 0, a1: 90, lt: 'visible' },
      { id: 'h', k: 'hatch', of: 'r', spacing: 2, angle: 45 },
      { id: 'n', k: 'note', p: [100, 100], text: 'NOTE 1' },
    ]);
    const ps = paths(d);
    expect(ps.find((p) => p.owner === 'c')!.d).toContain('A10 10 0 1 0');
    expect(ps.find((p) => p.owner === 'p')!.d.endsWith('Z')).toBe(true);
    expect(ps.find((p) => p.owner === 'a')!.d).toContain('A5 5 0 0 0');
    expect(ps.find((p) => p.owner === 'h')!.role).toBe('hatch');
    expect(texts(d).map((t) => t.text)).toContain('NOTE 1');
  });

  it('skips a hatch whose outline is gone and a dimension whose geometry is gone', () => {
    const d = doc([{ id: 'h', k: 'hatch', of: 'missing', spacing: 2, angle: 45 }], [dim]);
    expect(paths(d).filter((p) => p.owner === 'h' || p.owner === 'd1')).toEqual([]);
  });

  it('puts the title block fields and the tolerance note on the sheet', () => {
    const d = doc([], [], {
      title: { ...emptyDoc().title, title: 'Bracket', drawnBy: 'EJ', scale: '1:2', material: '6061-T6', tolerance: '' },
    });
    const t = texts(d).map((x) => x.text);
    for (const label of Object.values(LABELS)) expect(t).toContain(label);
    expect(t).toContain('Bracket');
    expect(t).toContain('6061-T6');
  });
});

describe('SVG export', () => {
  const d = doc(
    [{ id: 'l1', k: 'line', a: [10, 10], b: [40, 50], lt: 'hidden' }],
    [{ id: 'd1', k: 'aligned', a: { id: 'l1', at: 'a' }, b: { id: 'l1', at: 'b' }, off: 6 }],
  );
  const svg = toSvg(d, LABELS, 'Drafting sheet with 1 dimension');
  it('is a standalone sheet at true size', () => {
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210"'),
    ).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title>Drafting sheet with 1 dimension</title>');
    expect(svg).toContain('>50.00</text>');
    expect(svg).toContain('stroke-dasharray="3 1.5"');
  });
  it('escapes text', () => {
    const n = toSvg(doc([{ id: 'n', k: 'note', p: [1, 1], text: 'A < B & "C"' }]), LABELS, 'x');
    expect(n).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(n).not.toContain('A < B');
  });
  it('is valid XML-ish: balanced tags', () => {
    expect((svg.match(/<text /g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
  it('bearing', () => {
    expect(bearing([0, 0], [1, 0])).toBe(0);
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(90, 9);
    expect(bearing([0, 0], [-1, 0])).toBeCloseTo(180, 9);
    expect(bearing([0, 0], [0, -1])).toBeCloseTo(270, 9);
  });
});
