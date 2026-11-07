// Breaks, saved headers and footers, page number formats, columns, and line numbers (text:page-layout). The expected
// values come from the format spec (R-BRK-1 to 3, R-LAY-1, R-VIEW-2, R-VIEW-3, R-PRN-1, R-PRN-2) and hand-worked sums.
import { describe, expect, it } from 'vitest';
import { ENGLISH_LABELS, strokesByBlock, type BlockContext } from '../export/blocks';
import { readingOrder } from '../export/order';
import { readExportPage } from '../export/source';
import { lightTheme } from '../export/style';
import { pageLayout } from '../layout/page';
import { planPage } from '../layout/plan';
import { DEFAULT_VIEW } from '../layout/view';
import { flow as fakeFlow, type Spec } from '../pagination/flowFixture';
import { measureDocument, printDocument, type DocumentSetup } from './document';
import { bandForSheet, readLineNumbers, readPageNumbers, readSavedBands } from './headerFooter';
import { lineNumberMarks } from './lineNumbers';
import { withSavedSettings } from './prepare';
import { planPrint } from './sheets';
import { applyLayoutPatch, layoutCss, layoutPatch, layoutStyle, readBreakKind, readTextLayout } from './textLayout';
import { pageUnits } from './units';

const text = (id: string, markdown: string, order: string) => ({
  id,
  order,
  type: 'text',
  data: { markdown },
  created: '2026-10-01T10:00:00.000Z',
  modified: '2026-10-01T10:00:00.000Z',
});
const pageBreak = (id: string, order: string, kind = 'page') => ({
  id,
  order,
  type: 'break',
  data: { kind },
  fallback: { markdown: '---' },
  created: '2026-10-01T10:00:00.000Z',
  modified: '2026-10-01T10:00:00.000Z',
});

function pageOf(blocks: readonly object[], view: object = {}) {
  return readExportPage({
    id: 'p',
    title: 'T',
    created: '2026-10-01T10:00:00.000Z',
    modified: '2026-10-01T10:00:00.000Z',
    tags: [],
    assets: {},
    view,
    blocks,
  });
}

/** The units of a page with fixed line heights, in place of a browser's layout, and the document they print into. */
function setupFor(page: ReturnType<typeof pageOf>) {
  const layout = pageLayout(DEFAULT_VIEW);
  const cx: BlockContext = {
    page,
    labels: ENGLISH_LABELS,
    assetUrl: () => null,
    strokes: strokesByBlock(page.strokes),
  };
  const units = pageUnits(readingOrder(page.blocks, page.view.readingOrder), cx);
  const specs: Spec[] = units.flow.map((u): Spec =>
    u.flow.kind === 'break'
      ? { id: u.id, kind: 'break' }
      : { id: u.id, kind: 'text', lines: 3, heading: u.flow.heading },
  );
  const { blocks, measure } = fakeFlow(specs, layout.flowSheet.margins[0]);
  const setup: DocumentSetup = { page, layout, units, cx, theme: lightTheme() };
  return { setup, blocks, measure, layout };
}

function printed(page: ReturnType<typeof pageOf>, print: Parameters<typeof withSavedSettings>[0] = {}) {
  const { setup, blocks, measure, layout } = setupFor(page);
  const plan = planPage(layout, { flow: { blocks, measure } });
  const sheets = planPrint(layout.sheet, plan.sheets, withSavedSettings(print, page.rawView));
  const tops = new Map(setup.units.flow.map((u) => [u.id, { top: 0, first: 0 }]));
  const html = printDocument(setup, sheets, {
    plan,
    floatRects: new Map(),
    unitTops: tops,
    ink: [],
    slice: (id, from, to) => `<p data-cut="${id}:${from}-${to}"></p>`,
  });
  return { html, plan, sheets, setup };
}

describe('break blocks', () => {
  const blocks = [text('a', 'First.', 'a'), pageBreak('brk', 'b'), text('z', 'Second.', 'c')];

  it('read as break units, and the data of a break is page unless it says column', () => {
    const page = pageOf(blocks);
    expect(page.blocks.map((b) => (b.type === 'other' ? b.kind : b.type))).toEqual(['text', 'break', 'text']);
    expect(readBreakKind({ kind: 'column' })).toBe('column');
    expect(readBreakKind({ kind: 'page' })).toBe('page');
    expect(readBreakKind({})).toBe('page');
    expect(readBreakKind({ kind: 'section' })).toBe('page');
    expect(readBreakKind(undefined)).toBe('page');
  });

  it('starts a new sheet in the paginator and in the print document at the same place', () => {
    const { html, plan } = printed(pageOf(blocks));
    const forced = plan.flow?.plan.breaks.filter((b) => b.forced) ?? [];
    expect(forced).toHaveLength(1);
    // The paginator starts sheet 2 before the block after the break.
    expect(forced[0].pos).toEqual({ kind: 'block', block: 'z' });
    expect(plan.sheets).toBe(2);
    const sheets = html.split('<section class="sheet"').slice(1);
    expect(sheets).toHaveLength(2);
    // The document puts that same block on sheet 2, and the block before the break on sheet 1.
    expect(sheets[0]).toContain('data-sheet="1"');
    expect(sheets[0]).toContain('First.');
    expect(sheets[0]).not.toContain('Second.');
    expect(sheets[1]).toContain('data-sheet="2"');
    expect(sheets[1]).toContain('Second.');
    expect(sheets[1]).not.toContain('First.');
  });

  it('acts as a page break for a column break where there are no columns, and a break at the end adds a sheet', () => {
    const column = printed(pageOf([text('a', 'One.', 'a'), pageBreak('c', 'b', 'column'), text('z', 'Two.', 'c')]));
    expect(column.plan.sheets).toBe(2);
    const end = printed(pageOf([text('a', 'One.', 'a'), pageBreak('c', 'b')]));
    expect(end.plan.sheets).toBe(2);
  });
});

describe('page numbers', () => {
  const paper = pageLayout(DEFAULT_VIEW).sheet;

  it('print iii on the first sheet in lowerRoman starting at 3', () => {
    const view = { text: { pageNumbers: { format: 'lowerRoman', start: 3 } } };
    const plan = planPrint(paper, 3, withSavedSettings({ footer: { center: '{page}' } }, view));
    expect(plan.sheets.map((s) => s.footer?.center)).toEqual(['iii', 'iv', 'v']);
  });

  it('write each format by hand-worked values', () => {
    const at = (format: string, start: number, sheets: number) =>
      planPrint(paper, sheets, {
        footer: { center: '{page}' },
        pageNumbers: readPageNumbers({ text: { pageNumbers: { format, start } } }),
      }).sheets.map((s) => s.footer?.center);
    expect(at('upperRoman', 1, 4)).toEqual(['I', 'II', 'III', 'IV']);
    expect(at('lowerLetter', 1, 3)).toEqual(['a', 'b', 'c']);
    expect(at('upperLetter', 26, 2)).toEqual(['Z', 'AA']);
    expect(at('decimal', 0, 2)).toEqual(['0', '1']);
  });

  it('read a bad value as the default for that key', () => {
    expect(readPageNumbers({ text: { pageNumbers: { format: 'ordinal', start: -4 } } })).toEqual({
      format: 'decimal',
      start: 1,
    });
    expect(readPageNumbers({ text: { pageNumbers: { start: 32768 } } }).start).toBe(1);
    expect(readPageNumbers({ text: { pageNumbers: { start: 32767 } } }).start).toBe(32767);
    expect(readPageNumbers({})).toEqual({ format: 'decimal', start: 1 });
  });

  it('leave {pages} in decimal, as the total of sheets', () => {
    const view = { text: { pageNumbers: { format: 'upperRoman' } } };
    const plan = planPrint(paper, 3, withSavedSettings({ footer: { center: '{page} of {pages}' } }, view));
    expect(plan.sheets.map((s) => s.footer?.center)).toEqual(['I of 3', 'II of 3', 'III of 3']);
  });
});

describe('saved headers and footers', () => {
  const view = {
    print: {
      header: { left: '{title}', right: 'Draft', firstPage: {} },
      footer: { center: 'Page {page}', firstPage: { center: 'Cover' } },
    },
  };

  it('read the bands of view.print, and a part that is not a short string as missing', () => {
    const saved = readSavedBands(view);
    expect(saved.header).toEqual({ left: '{title}', right: 'Draft', firstPage: {} });
    expect(saved.footer?.firstPage).toEqual({ center: 'Cover' });
    expect(readSavedBands({ print: { header: { left: 'x'.repeat(201), center: 4, right: 'ok' } } }).header).toEqual({
      right: 'ok',
    });
    expect(readSavedBands({ print: { header: 'nope' } })).toEqual({});
    expect(readSavedBands(null)).toEqual({});
  });

  it('show the first-page band on the first sheet only, and an empty one hides the band there', () => {
    const paper = pageLayout(DEFAULT_VIEW).sheet;
    const plan = planPrint(paper, 3, { ...withSavedSettings({}, view), fields: { title: 'Cells' } });
    expect(plan.sheets.map((s) => s.footer?.center)).toEqual(['Cover', 'Page 2', 'Page 3']);
    // The first sheet's header is empty, so it draws nothing; the others show the header.
    expect(plan.sheets.map((s) => s.header?.left ?? null)).toEqual([null, 'Cells', 'Cells']);
    expect(bandForSheet(saved(view).header, 0)).toEqual({});
    expect(bandForSheet(saved(view).header, 1)).toEqual(saved(view).header);
  });

  it('let the print dialog override the saved band', () => {
    const merged = withSavedSettings({ header: { center: 'Dialog' } }, view);
    expect(merged.header).toEqual({ center: 'Dialog' });
    expect(merged.footer?.center).toBe('Page {page}');
  });

  it('draw in the print document from the page view', () => {
    const page = pageOf([text('a', 'One.', 'a'), pageBreak('b', 'b'), text('z', 'Two.', 'c')], view);
    const { html } = printed(page);
    expect(html).toContain('<span>Cover</span>');
    expect(html).toContain('<span>Page 2</span>');
  });
});

function saved(view: object) {
  return readSavedBands(view);
}

describe('columns', () => {
  it('compute column-count 2 and the gap in px from points', () => {
    const layout = readTextLayout({ layout: { columns: 2, gap: 18 } });
    expect(layoutCss(layout)).toEqual({ columnCount: 2, columnGap: '24px' });
    expect(layoutStyle(layout)).toBe('column-count:2;column-gap:24px');
  });

  it('use the spec defaults: one column, a 36 point gap, no rule', () => {
    expect(readTextLayout({})).toEqual({ columns: 1, gap: 36, rule: false, vertical: false });
    expect(layoutCss(readTextLayout({}))).toEqual({});
    expect(layoutCss(readTextLayout({ layout: { columns: 3 } })).columnGap).toBe('48px');
    expect(layoutCss(readTextLayout({ layout: { columns: 2, rule: true } })).columnRule).toBe('1px solid currentColor');
  });

  it('read a value out of range as its default (R-LAY-1)', () => {
    expect(readTextLayout({ layout: { columns: 5, gap: -1 } })).toMatchObject({ columns: 1, gap: 36 });
    expect(readTextLayout({ layout: { columns: 2.5, gap: 1585 } })).toMatchObject({ columns: 1, gap: 36 });
    expect(readTextLayout({ layout: { columns: 4, gap: 1584 } })).toMatchObject({ columns: 4, gap: 1584 });
  });

  it('go back to no layout key when the last setting returns to its default', () => {
    expect(layoutPatch({}, { columns: 2 })).toEqual({ layout: { columns: 2 } });
    expect(layoutPatch({ layout: { columns: 2 } }, { columns: 1 })).toEqual({ layout: null });
    expect(layoutPatch({ layout: { columns: 2, gap: 12 } }, { columns: 1 })).toEqual({
      layout: { columns: null, gap: 12 },
    });
  });

  it('remove a key in the stored data when applied as an RFC 7396 merge patch', () => {
    const data = { text: 'a', layout: { columns: 2, vertical: true } };
    const patch = layoutPatch(data, { columns: 1 });
    expect(patch).toEqual({ layout: { columns: null, vertical: true } });
    expect(applyLayoutPatch(data, patch)).toEqual({ text: 'a', layout: { vertical: true } });
    expect(applyLayoutPatch(data, layoutPatch(data, { columns: 1, vertical: false }))).toEqual({ text: 'a' });
  });

  it('print a block with columns as one unit that never splits, with its column style', () => {
    const page = pageOf([
      { ...text('a', 'One\n\nTwo', 'a'), data: { markdown: 'One\n\nTwo', layout: { columns: 2, gap: 18 } } },
    ]);
    const units = pageUnits(page.blocks, {
      page,
      labels: ENGLISH_LABELS,
      assetUrl: () => null,
      strokes: strokesByBlock(page.strokes),
    });
    expect(units.flow).toHaveLength(1);
    expect(units.flow[0].flow.kind).toBe('atom');
    expect(units.flow[0].html).toContain('style="column-count:2;column-gap:24px"');
    expect(measureDocument({ ...setupFor(page).setup })).toContain('column-count:2');
  });
});

describe('vertical text', () => {
  it('reads from the layout and draws vertical-rl', () => {
    const layout = readTextLayout({ layout: { vertical: true } });
    expect(layout.vertical).toBe(true);
    expect(layoutCss(layout).writingMode).toBe('vertical-rl');
    expect(readTextLayout({ layout: { vertical: 'yes' } }).vertical).toBe(false);
  });
});

describe('line numbers', () => {
  const line = (sheet: number, n: number) => ({ sheet, top: 100 * sheet + 20 * n, bottom: 100 * sheet + 20 * n + 20 });

  it('read the settings: absent is none, an empty object is on with the defaults (R-VIEW-2)', () => {
    expect(readLineNumbers({})).toBeNull();
    expect(readLineNumbers({ text: { lineNumbers: {} } })).toEqual({ start: 1, countBy: 1, restart: 'page' });
    expect(readLineNumbers({ text: { lineNumbers: { countBy: 5, restart: 'continuous', start: 10 } } })).toEqual({
      start: 10,
      countBy: 5,
      restart: 'continuous',
    });
    const bad = readLineNumbers({ text: { lineNumbers: { countBy: 0, start: 0 } } });
    expect(bad).toMatchObject({ countBy: 1, start: 1 });
  });

  it('count every line and restart on each sheet', () => {
    const lines = [line(0, 0), line(0, 1), line(0, 2), line(1, 0), line(1, 1)];
    const marks = lineNumberMarks({ start: 1, countBy: 1, restart: 'page' }, lines, 100);
    expect(marks.get(0)?.map((m) => m.label)).toEqual(['1', '2', '3']);
    expect(marks.get(1)?.map((m) => m.label)).toEqual(['1', '2']);
    // A mark sits at its line, measured from the top of its own sheet.
    expect(marks.get(1)?.[1]).toEqual({ label: '2', top: 20, height: 20 });
  });

  it('continue through the page and show every fifth number', () => {
    const lines = Array.from({ length: 12 }, (_, i) => line(i < 7 ? 0 : 1, i));
    const marks = lineNumberMarks({ start: 1, countBy: 5, restart: 'continuous' }, lines, 100);
    expect(marks.get(0)?.map((m) => m.label)).toEqual(['5']);
    expect(marks.get(1)?.map((m) => m.label)).toEqual(['10']);
  });

  it('start at the number given', () => {
    const marks = lineNumberMarks({ start: 8, countBy: 1, restart: 'continuous' }, [line(0, 0), line(1, 0)], 100);
    expect([...marks.values()].flat().map((m) => m.label)).toEqual(['8', '9']);
  });

  it('draw numbers in the left margin of each sheet of the print document, for text only', () => {
    const page = pageOf([text('a', 'One.', 'a'), pageBreak('b', 'b'), text('z', 'Two.', 'c')], {
      text: { lineNumbers: {} },
    });
    const { html } = printed(page);
    const sheets = html.split('<section class="sheet"').slice(1);
    // Each sheet has a text unit of three lines, so each shows 1, 2, 3.
    for (const sheet of sheets) {
      const numbers = [...sheet.matchAll(/<span style="position:absolute;left:0;right:0;[^>]*>(\d+)<\/span>/g)];
      expect(numbers.map((m) => m[1])).toEqual(['1', '2', '3']);
    }
    expect(printed(pageOf([text('a', 'One.', 'a')])).html).not.toContain('class="line-numbers"');
  });

  it('print a floating text box with its columns and vertical writing', () => {
    const page = pageOf([
      {
        ...text('a', 'One and Two', 'a'),
        data: { markdown: 'One and Two', layout: { columns: 2, vertical: true } },
        frame: { x: 10, y: 20 },
      },
    ]);
    const html = measureDocument({ ...setupFor(page).setup });
    expect(html).toMatch(/class="float"[^>]*style="[^"]*column-count:2[^"]*writing-mode:vertical-rl/);
  });
});
