import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { contentBottom, contentTop, sheetAt } from '../pagination/geometry';
import { atom, flow, pageBreak, placed, table, text, type Spec } from '../pagination/flowFixture';
import { setBackground, setContentWidth, setLayout, setMargins, setMode, setPaperSize } from './edit';
import { displayY, naturalY, planFlow, slicesBySheet } from './flow';
import { columnOf, MIN_COLUMN, pageLayout } from './page';
import { planPage } from './plan';
import { DEFAULT_VIEW } from './view';

const LETTER = pageLayout(DEFAULT_VIEW);

describe('page layout', () => {
  it('derives the sheet from the paper and keeps margins within it', () => {
    expect(LETTER.sheet).toMatchObject({ width: 816, height: 1056, margins: [72, 72, 72, 72] });
    const a4 = pageLayout(setPaperSize(DEFAULT_VIEW, 'a4', 'landscape'));
    expect(a4.sheet).toMatchObject({ width: 1122.52, height: 793.7 });
    expect(pageLayout(setMargins(DEFAULT_VIEW, [0, 0, 0, 0])).sheet.margins).toEqual([24, 24, 24, 24]);
  });

  it('reports the mode and layout', () => {
    const view = setLayout(setMode(DEFAULT_VIEW, 'paginated'), 'flow');
    expect(pageLayout(view)).toMatchObject({ paginated: true, flow: true });
    expect(LETTER).toMatchObject({ paginated: false, flow: false });
  });

  it('flows text in the same column in both modes, so switching never rewraps it', () => {
    const flowView = setContentWidth(setLayout(DEFAULT_VIEW, 'flow'), 400);
    const paginated = pageLayout(setMode(flowView, 'paginated'));
    const infinite = pageLayout(setMode(flowView, 'infinite'));
    expect(paginated.column).toEqual(infinite.column);
    expect(paginated.column).toEqual({ x: 208, width: 400 });
    expect(LETTER.column).toEqual({ x: 72, width: 672 });
  });

  it('keeps the column within the content box and above the least width', () => {
    expect(columnOf(LETTER.sheet, 5000)).toEqual({ x: 72, width: 672 });
    expect(columnOf(LETTER.sheet, 10).width).toBe(MIN_COLUMN);
  });

  it('flows text in the notes area of Cornell paper', () => {
    const cornell = pageLayout(setBackground(DEFAULT_VIEW, { pattern: 'cornell' }));
    expect(cornell.flowSheet.margins[3]).toBeGreaterThan(LETTER.sheet.margins[3]);
    expect(cornell.flowSheet.margins[2]).toBeGreaterThan(LETTER.sheet.margins[2]);
    expect(cornell.column.x).toBe(cornell.flowSheet.margins[3]);
  });

  it('resolves a saved template by its ID, and draws nothing for one that is missing', () => {
    const view = setBackground(DEFAULT_VIEW, { pattern: 'template', template: 'abc' });
    const template = { id: 'abc', title: 'T', area: 'content' as const, elements: [] };
    expect(pageLayout(view, (id) => (id === 'abc' ? template : undefined)).background.template).toBe(template);
    expect(pageLayout(view).background.template).toBeUndefined();
  });
});

function planOf(specs: readonly Spec[], layout = LETTER) {
  const { blocks, measure } = flow(specs, layout.flowSheet.margins[0]);
  return { blocks, measure, plan: planFlow(layout.flowSheet, blocks, measure) };
}

describe('planning a flow', () => {
  it('lands each line and row where the paginator placed it', () => {
    const specs = [text('a', 50), table('t', 10, { headerRows: 1 }), atom('img', 300), pageBreak('b'), text('z', 4)];
    const { blocks, measure, plan } = planOf(specs);
    const expected = placed(LETTER.flowSheet, plan.plan, blocks, measure);
    expect(plan.pieces).toEqual(expected);
  });

  it('groups the pieces of a block on a sheet into slices', () => {
    const { plan } = planOf([text('a', 60)]);
    expect(plan.plan.sheets).toBe(2);
    expect(plan.slices).toHaveLength(2);
    const [first, second] = plan.slices;
    expect(first).toMatchObject({ block: 'a', sheet: 0, from: 0, whole: false });
    expect(second).toMatchObject({ block: 'a', sheet: 1, to: 60, whole: false });
    expect(first.to).toBe(second.from);
    expect(slicesBySheet(plan).map((s) => s.length)).toEqual([1, 1]);
  });

  it('marks a block that stays whole, and reports the header a table repeats', () => {
    const { plan } = planOf([text('a', 3), table('t', 40, { headerRows: 2, together: false })]);
    const whole = plan.slices.find((s) => s.block === 'a');
    expect(whole).toMatchObject({ whole: true, from: 0, to: 3 });
    const tail = plan.slices.filter((s) => s.block === 't' && s.sheet > 0);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((s) => s.repeatedHeader === 60)).toBe(true);
    expect(plan.slices.find((s) => s.block === 't' && s.sheet === 0)?.repeatedHeader).toBe(0);
  });

  it('gives an empty flow one sheet with nothing on it', () => {
    const { plan } = planOf([]);
    expect(plan.plan.sheets).toBe(1);
    expect(slicesBySheet(plan)).toEqual([[]]);
  });

  it('adds a sheet for a manual break at the end, and an empty sheet for two in a row', () => {
    expect(planOf([text('a', 3), pageBreak('b')]).plan.plan.sheets).toBe(2);
    const twice = planOf([text('a', 3), pageBreak('b'), pageBreak('c'), text('d', 2)]);
    expect(twice.plan.plan.sheets).toBe(3);
    expect(slicesBySheet(twice.plan).map((s) => s.length)).toEqual([1, 0, 1]);
  });

  it('measures each block once', () => {
    const { blocks, measure } = flow([text('a', 100), table('t', 20)], 72);
    let calls = 0;
    planFlow(LETTER.flowSheet, blocks, (b) => {
      calls += 1;
      return measure(b);
    });
    expect(calls).toBe(2);
  });
});

describe('moving between natural and displayed positions', () => {
  const { blocks, measure, plan } = planOf([text('a', 90), atom('img', 200), text('b', 30)]);

  it('adds the spacers above a position', () => {
    expect(displayY(plan, 0)).toBe(0);
    const second = plan.pieces.find((p) => p.sheet === 1)!;
    const natural = measure(blocks[0]).lines![second.index].top;
    expect(displayY(plan, natural)).toBe(second.top);
    expect(sheetAt(LETTER.flowSheet, displayY(plan, natural))).toBe(1);
  });

  it('is undone by naturalY for every piece', () => {
    for (const piece of plan.pieces) {
      const m = measure(blocks.find((b) => b.id === piece.block)!);
      const natural = (m.lines ?? m.rows ?? [m])[piece.index].top;
      expect(displayY(plan, natural)).toBeCloseTo(piece.top);
      expect(naturalY(plan, piece.top)).toBeCloseTo(natural);
    }
  });

  it('maps a position inside a spacer to just above the break', () => {
    const first = plan.plan.breaks[0];
    expect(first).toBeDefined();
    const above = naturalY(plan, contentTop(LETTER.flowSheet, 1) - 1);
    const breakTop = measure(blocks[0]).lines![first.pos.kind === 'line' ? first.pos.line : 0].top;
    expect(above).toBeLessThan(breakTop);
  });
});

const spec = fc.oneof(
  fc.record({ kind: fc.constant('text' as const), lines: fc.integer({ min: 1, max: 80 }), heading: fc.boolean() }),
  fc.record({
    kind: fc.constant('table' as const),
    rows: fc.integer({ min: 1, max: 40 }),
    headerRows: fc.integer({ min: 0, max: 2 }),
  }),
  fc.record({ kind: fc.constant('atom' as const), height: fc.integer({ min: 40, max: 600 }) }),
  fc.record({ kind: fc.constant('break' as const) }),
);

describe('flow plan properties', () => {
  it('puts every piece inside a content box, in reading order, and slices cover each piece once', () => {
    fc.assert(
      fc.property(fc.array(spec, { maxLength: 12 }), (raw) => {
        const specs = raw.map((s, i) => ({ id: `b${i}`, ...s }) as Spec);
        const { plan } = planOf(specs);
        const g = LETTER.flowSheet;
        let last = -Infinity;
        for (const piece of plan.pieces) {
          if (plan.plan.warnings.some((w) => w.block === piece.block)) continue;
          expect(piece.top).toBeGreaterThanOrEqual(contentTop(g, piece.sheet) - 0.01);
          expect(piece.bottom).toBeLessThanOrEqual(contentBottom(g, piece.sheet) + 0.01);
        }
        for (const piece of plan.pieces) {
          expect(piece.top).toBeGreaterThanOrEqual(last - 0.01);
          last = piece.top;
        }
        const covered = plan.slices.reduce((n, s) => n + (s.to - s.from), 0);
        expect(covered).toBe(plan.pieces.length);
        expect(plan.plan.sheets).toBeGreaterThanOrEqual(Math.max(0, ...plan.pieces.map((p) => p.sheet)) + 1);
      }),
      { numRuns: 200 },
    );
  });
});

describe('planning a page', () => {
  it('takes the larger sheet count of the flow and the floating blocks', () => {
    const { blocks, measure } = flow([text('a', 10)], 72);
    const floating = [{ id: 'ink', rect: { x: 0, y: 2000, w: 100, h: 200 } }];
    const page = planPage(LETTER, { flow: { blocks, measure }, floating });
    expect(page.sheets).toBe(3);
    expect(page.bySheet).toHaveLength(3);
    expect(page.bySheet[0].flow).toHaveLength(1);
    expect(page.bySheet[2].floating.map((f) => f.id)).toEqual(['ink']);
  });

  it('splits a floating block across the sheets it touches and reports it', () => {
    const floating = [{ id: 'img', rect: { x: 100, y: 1000, w: 200, h: 200 } }];
    const page = planPage(LETTER, { floating });
    expect(page.sheets).toBe(2);
    expect(page.floating.crossing).toEqual(['img']);
    expect(page.bySheet[0].floating[0].rect).toEqual({ x: 100, y: 1000, w: 200, h: 56 });
    expect(page.bySheet[1].floating[0].rect).toEqual({ x: 100, y: 1056, w: 200, h: 144 });
  });

  it('gives an empty page one sheet', () => {
    expect(planPage(LETTER, {})).toMatchObject({ sheets: 1, flow: null });
  });
});
