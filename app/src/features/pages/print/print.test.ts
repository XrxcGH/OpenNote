import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ENGLISH_LABELS, strokesByBlock, type BlockContext } from '../export/blocks';
import { readingOrder } from '../export/order';
import { readExportPage, type InkBlock } from '../export/source';
import { lightTheme } from '../export/style';
import { pageLayout } from '../layout/page';
import { planPage } from '../layout/plan';
import { setMargins, setPaperSize } from '../layout/edit';
import { DEFAULT_VIEW } from '../layout/view';
import { planFlow } from '../layout/flow';
import { flow as fakeFlow, type Spec } from '../pagination/flowFixture';
import type { BlockMeasure } from '../pagination/types';
import { MAX_SHEETS, contentBottom, contentTop } from '../pagination/geometry';
import { lecturePage } from '../testing/samples';
import { measureDocument, printDocument, type DocumentSetup } from './document';
import { anchoredShift } from './prepare';
import { bandBox, fillBand, fillTemplate } from './headerFooter';
import { parsePageRange } from './range';
import { chromiumPageFor, planPrint } from './sheets';
import { measureCss, printCss } from './css';
import { pageUnits } from './units';

describe('page ranges', () => {
  it('reads lists, spans, and open ends, and counts sheets from 1', () => {
    expect(parsePageRange('1-3, 5', 8).sheets).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('6-', 8).sheets).toEqual([5, 6, 7]);
    expect(parsePageRange('-2', 8).sheets).toEqual([0, 1]);
    expect(parsePageRange('5-2', 8).sheets).toEqual([1, 2, 3, 4]);
    expect(parsePageRange('3;1,3', 8).sheets).toEqual([0, 2]);
    expect(parsePageRange('', 3).sheets).toEqual([0, 1, 2]);
  });

  it('drops numbers past the end, and refuses text that selects nothing', () => {
    expect(parsePageRange('2-99', 3).sheets).toEqual([1, 2]);
    expect(parsePageRange('9', 3)).toEqual({ sheets: [], error: 'empty' });
    expect(parsePageRange('a-b', 3).error).toBe('syntax');
    expect(parsePageRange('1,,2', 3).error).toBe('syntax');
    expect(parsePageRange('3 4', 9).error).toBe('syntax');
  });

  it('keeps odd or even sheets by their number', () => {
    expect(parsePageRange('', 6, 'odd').sheets).toEqual([0, 2, 4]);
    expect(parsePageRange('', 6, 'even').sheets).toEqual([1, 3, 5]);
    expect(parsePageRange('2-4', 6, 'odd').sheets).toEqual([2]);
  });

  it('never returns a sheet twice or out of order, for any text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.integer({ min: 1, max: 30 }), (text, count) => {
        const { sheets } = parsePageRange(text, count);
        expect(sheets).toEqual([...new Set(sheets)].sort((a, b) => a - b));
        expect(sheets.every((s) => s >= 0 && s < count)).toBe(true);
      }),
    );
  });
});

describe('headers and footers', () => {
  const fields = { page: 2, pages: 7, title: 'Biology', notebook: 'Term 1', date: '2 October 2026' };

  it('fills in the fields and keeps other text', () => {
    expect(fillTemplate('Page {page} of {pages}', fields)).toBe('Page 2 of 7');
    expect(fillTemplate('{notebook} - {title} - {date}', fields)).toBe('Term 1 - Biology - 2 October 2026');
    expect(fillTemplate('{unknown} {section}', fields)).toBe('{unknown} ');
    expect(fillTemplate(undefined, fields)).toBe('');
  });

  it('gives nothing for a band with no text', () => {
    expect(fillBand(undefined, fields)).toBeNull();
    expect(fillBand({ left: '', center: '{section}' }, fields)).toBeNull();
    expect(fillBand({ right: '{page}' }, fields)).toEqual({ left: '', center: '', right: '2' });
  });

  it('sits in the middle of the margin, from the left margin to the right margin', () => {
    const g = pageLayout(DEFAULT_VIEW).sheet;
    expect(bandBox(g, 'header')).toEqual({ x: 72, y: 28, w: 672, h: 16 });
    expect(bandBox(g, 'footer')).toEqual({ x: 72, y: 1056 - 72 + 28, w: 672, h: 16 });
  });

  it('is left out when the margin is too small to hold it', () => {
    const g = pageLayout(setMargins(DEFAULT_VIEW, [30, 72, 48, 72])).sheet;
    expect(bandBox(g, 'header')).toBeNull();
    expect(bandBox(g, 'footer')).not.toBeNull();
  });
});

describe('the print plan', () => {
  const letter = pageLayout(DEFAULT_VIEW).sheet;

  it('prints at most MAX_SHEETS sheets, and says so', () => {
    const plan = planPrint(letter, 10_000_000);
    expect(plan.total).toBe(MAX_SHEETS);
    expect(plan.sheets).toHaveLength(MAX_SHEETS);
    expect(plan.warnings).toEqual([{ kind: 'tooManySheets', limit: MAX_SHEETS }]);
    expect(planPrint(letter, 3).warnings).toEqual([]);
  });

  it('uses the paper as the sheet box where Chromium writes the same page', () => {
    const plan = planPrint(letter, 3);
    expect(plan.box).toEqual({ width: 816, height: 1056 });
    expect(plan.sheets.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('shrinks A4 to the page Chromium writes, so print never scales the page (ADR 0006, rule 2)', () => {
    const a4 = pageLayout(setPaperSize(DEFAULT_VIEW, 'a4')).sheet;
    const plan = planPrint(a4, 1);
    expect(plan.box.width).toBeCloseTo(594.96 / 0.75, 6);
    expect(plan.box.height).toBeCloseTo(1122.52, 2);
    expect(plan.paper).toEqual({ width: 793.7, height: 1122.52 });
    const landscape = pageLayout(setPaperSize(DEFAULT_VIEW, 'a4', 'landscape')).sheet;
    expect(planPrint(landscape, 1).box.height).toBeCloseTo(594.96 / 0.75, 6);
  });

  it('knows Letter and A4 in both orientations and nothing else', () => {
    expect(chromiumPageFor({ width: 816, height: 1056 })).toEqual({ width: 612, height: 792 });
    expect(chromiumPageFor({ width: 1056, height: 816 })).toEqual({ width: 792, height: 612 });
    expect(chromiumPageFor({ width: 793.7, height: 1122.52 })).toEqual({ width: 594.96, height: 841.92 });
    expect(chromiumPageFor({ width: 816, height: 1344 })).toBeUndefined();
  });

  it('prints the sheets in the range, numbered by place or by count', () => {
    const footer = { right: '{page}/{pages}' };
    const placed = planPrint(letter, 6, { range: '3-4', footer });
    expect(placed.sheets.map((s) => s.footer?.right)).toEqual(['3/6', '4/6']);
    const counted = planPrint(letter, 6, { range: '3-4', footer, numbering: 'printed' });
    expect(counted.sheets.map((s) => s.footer?.right)).toEqual(['1/2', '2/2']);
    expect(placed.total).toBe(6);
  });

  it('prints every sheet and says so when the range is not valid', () => {
    const plan = planPrint(letter, 3, { range: '7' });
    expect(plan.sheets).toHaveLength(3);
    expect(plan.warnings).toEqual([{ kind: 'range', error: 'empty' }]);
    expect(planPrint(letter, 3, { range: 'x' }).warnings).toEqual([{ kind: 'range', error: 'syntax' }]);
  });

  it('warns when a header or footer does not fit the margin', () => {
    const tight = pageLayout(setMargins(DEFAULT_VIEW, [24, 72, 24, 72])).sheet;
    const plan = planPrint(tight, 1, { header: { center: 'x' }, footer: { center: 'y' } });
    expect(plan.warnings).toEqual([
      { kind: 'marginTooSmall', band: 'header' },
      { kind: 'marginTooSmall', band: 'footer' },
    ]);
    expect(plan.sheets[0].header).toBeNull();
  });

  it('prints paper and ink unless told not to', () => {
    expect(planPrint(letter, 1)).toMatchObject({ background: true, ink: true });
    expect(planPrint(letter, 1, { background: false, ink: false })).toMatchObject({ background: false, ink: false });
  });
});

describe('the print stylesheet', () => {
  it('maps each sheet to one page with no margins, and breaks after every sheet but the last', () => {
    const css = printCss(planPrint(pageLayout(setPaperSize(DEFAULT_VIEW, 'a4')).sheet, 2), lightTheme());
    expect(css).toContain('@page{size:793.28px 1122.52px;margin:0}');
    expect(css).toContain('break-after:page');
    expect(css).toContain('.sheet:last-child{break-after:auto');
    expect(css).toContain('print-color-adjust:exact');
  });

  it('carries the paper colors as the light values, and has no border', () => {
    const css = printCss(planPrint(pageLayout(DEFAULT_VIEW).sheet, 1), lightTheme());
    expect(css).toContain('--color-border-subtle:');
    expect(css).toContain('--color-pen-fern:');
    expect(css).not.toMatch(/[;{\s]border(-(top|right|bottom|left|width|style|color))?\s*:/);
    expect(measureCss()).toContain('#measure');
  });
});

/** The units of the lecture page with lines and rows of fixed height, in place of a browser's layout. */
function setupFor(view = DEFAULT_VIEW) {
  const page = { ...lecturePage(), view };
  const layout = pageLayout(view);
  const cx: BlockContext = {
    page,
    labels: ENGLISH_LABELS,
    assetUrl: () => 'assets/leaf.png',
    strokes: strokesByBlock(page.strokes),
  };
  const units = pageUnits(readingOrder(page.blocks, page.view.readingOrder), cx);
  const setup: DocumentSetup = { page, layout, units, cx, theme: lightTheme() };
  const specs: Spec[] = units.flow.map((u): Spec => {
    if (u.flow.kind === 'break') return { id: u.id, kind: 'break' };
    if (u.table) return { id: u.id, kind: 'table', rows: u.table.rows.length, headerRows: 1 };
    if (u.flow.kind === 'atom') return { id: u.id, kind: 'atom', height: 120 };
    return { id: u.id, kind: 'text', lines: 4 + (u.id.length % 5), heading: u.flow.heading };
  });
  const { blocks, measure } = fakeFlow(specs, layout.flowSheet.margins[0]);
  return { setup, blocks, measure, layout };
}

describe('the print documents', () => {
  it('lay out the flow in its column for measuring, and the floating blocks where they sit', () => {
    const { setup } = setupFor();
    const html = measureDocument(setup);
    expect(html).toContain('<div id="measure">');
    expect(html).toContain('left:72px;width:672px;padding-top:72px');
    expect((html.match(/data-unit="/g) ?? []).length).toBe(setup.units.flow.length);
    expect(html).toContain("default-src 'none'");
  });

  it('put each part of the page on its sheet, with a header and footer, split tables, and numbered sheets', () => {
    const { setup, blocks, measure, layout } = setupFor();
    const plan = planPage(layout, { flow: { blocks, measure } });
    expect(plan.sheets).toBeGreaterThan(2);
    const print = planPrint(layout.sheet, plan.sheets, {
      footer: { center: '{page}' },
      header: { left: '{title}' },
      fields: { title: 'T' },
    });
    const tops = new Map(
      setup.units.flow.map((u) => [
        u.id,
        {
          top: measure(blocks.find((b) => b.id === u.id)!).top,
          first: measure(blocks.find((b) => b.id === u.id)!).top,
        },
      ]),
    );
    const html = printDocument(setup, print, {
      plan,
      floatRects: new Map(),
      unitTops: tops,
      ink: [],
      slice: (id, from, to) => `<p data-cut="${id}:${from}-${to}"></p>`,
    });
    expect((html.match(/<section class="sheet"/g) ?? []).length).toBe(plan.sheets);
    expect(html).toContain('class="hf hf-footer"');
    expect(html).toContain('<span>T</span>');
    for (let k = 1; k <= plan.sheets; k += 1) expect(html).toContain(`data-sheet="${k}"`);
    // Every sheet's slices lie inside the content box, as the plan says.
    for (const m of html.matchAll(/class="slice[^"]*" style="[^"]*top:(-?[\d.]+)px/g)) {
      const top = Number(m[1]);
      expect(top).toBeGreaterThanOrEqual(contentTop(layout.sheet, 0) - 0.01 - 60);
      expect(top).toBeLessThan(layout.sheet.height);
    }
    // A table that continues on a sheet draws its header again.
    expect(html).toMatch(/<thead><tr><th scope="col">Column 1/);
  });

  it('cover every line of every unit exactly once, whatever the paper', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('letter', 'a4', 'a5', 'legal', 'tabloid'),
        fc.constantFrom('portrait', 'landscape'),
        (size, orientation) => {
          const view = setPaperSize(DEFAULT_VIEW, size as 'letter', orientation as 'portrait');
          const { setup, blocks, measure, layout } = setupFor(view);
          const plan = planPage(layout, { flow: { blocks, measure } });
          const print = planPrint(layout.sheet, plan.sheets);
          const tops = new Map(setup.units.flow.map((u) => [u.id, { top: 0, first: 0 }]));
          const cuts: string[] = [];
          printDocument(setup, print, {
            plan,
            floatRects: new Map(),
            unitTops: tops,
            ink: [],
            slice: (id, from, to) => {
              cuts.push(`${id}:${from}-${to}`);
              return '';
            },
          });
          // The slices of a unit are consecutive: each starts where the one before it ended.
          const byUnit = new Map<string, [number, number][]>();
          for (const slice of plan.flow?.slices ?? [])
            byUnit.set(slice.block, [...(byUnit.get(slice.block) ?? []), [slice.from, slice.to]]);
          for (const ranges of byUnit.values()) {
            ranges.forEach(([from], i) => expect(from).toBe(i === 0 ? 0 : ranges[i - 1][1]));
          }
          for (const slice of plan.flow?.slices ?? []) {
            expect(contentBottom(layout.flowSheet, slice.sheet)).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('anchored ink in print', () => {
  const layout = pageLayout(DEFAULT_VIEW);
  // 37 lines fill most of a Letter sheet, so the 6-line paragraph `p#1` moves whole to the next sheet.
  const { blocks, measure } = fakeFlow(
    [
      { id: 'a', kind: 'text', lines: 37 },
      { id: 'p#1', kind: 'text', lines: 6 },
    ],
    layout.flowSheet.margins[0],
  );
  const measured = new Map<string, BlockMeasure>();
  const flow = planFlow(layout.flowSheet, blocks, (b) => {
    const m = measure(b);
    measured.set(b.id, m);
    return m;
  });
  const lineTop = measured.get('p#1')!.lines![2].top;
  const ink = (anchor: string, role = 'anchored'): InkBlock => ({
    id: 'hl',
    order: 'a9',
    type: 'ink',
    role,
    alt: '',
    decorative: false,
    strokeCount: 1,
    frame: { x: 100, y: lineTop + 20 },
    anchor: { block: anchor, dx: 0, dy: 18 },
  });

  it('moves with the line of text it is tied to when a break moves that text', () => {
    const push = flow.plan.breaks[0].push;
    expect(flow.plan.breaks[0].pos).toEqual({ kind: 'block', block: 'p#1' });
    expect(push).toBeGreaterThan(0);
    expect(anchoredShift(ink('p'), flow, measured)).toBeCloseTo(push);
  });

  it('stays at its frame when its text does not move, does not flow, or it is not anchored', () => {
    expect(anchoredShift(ink('a'), flow, measured)).toBe(0);
    expect(anchoredShift(ink('missing'), flow, measured)).toBe(0);
    expect(anchoredShift(ink('p', 'layer'), flow, measured)).toBe(0);
  });
});

describe('reading anchored ink', () => {
  it('keeps the anchor', () => {
    const data = { role: 'anchored', anchor: { block: 'p', dy: 14 } };
    const page = readExportPage({ blocks: [{ id: 'hl', type: 'ink', order: 'a0', frame: { x: 1, y: 2 }, data }] });
    expect(page.blocks[0]).toMatchObject({ role: 'anchored', anchor: { block: 'p', dx: 0, dy: 14 } });
  });
});
