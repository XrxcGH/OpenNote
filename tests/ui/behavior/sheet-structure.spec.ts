// Structure commands in a browser (ADR 0056, DESIGN 13.2): freeze panes keep the header in view, hidden columns leave
// the layout and come back with their data, exact row heights are exact, and a fitted column holds its longest text.
// Each table is the HTML the render decorations give for the sheet that the real structure ops produce, so the test
// needs no editor, only the real stylesheet.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { applyTableOp } from '../../../app/src/editor/commands/tables';
import type { TableOp } from '../../../app/src/editor/commands/tables';
import type { TableData } from '../../../app/src/editor/schema/specs';
import { applyPatch } from '../../../app/src/features/tables/sheet/model/json';
import type { Json, JsonObject } from '../../../app/src/features/tables/sheet/model/json';
import type { Sheet } from '../../../app/src/features/tables/sheet/model/types';
import { Builder, MEASURE_SOURCE, harnessCss, tableHtml } from '../../../app/src/features/tables/sheet/render/harness';
import type { Harness } from '../../../app/src/features/tables/sheet/render/harness';
import '../../../app/src/features/tables/sheet/structure/hooks';
import { columnPadding, fitWidth } from '../../../app/src/features/tables/sheet/structure';
import { expect, test } from '../fixtures';

const scrollerCss = () =>
  readFileSync(join(import.meta.dirname, '../../../app/src/features/page/tables/tables.module.css'), 'utf8').replace(
    /:global\(([^()]*)\)/g,
    '$1',
  );

/** The table data of a harness table, with its widths. */
function dataOf(h: Harness): TableData {
  return {
    header: h.table.header === true,
    columns: h.table.columns.map((c, i) => ({ id: c.id, width: h.widths[i] })),
    rows: h.table.rows.map((r) => ({ id: r.id, cells: { ...r.cells } })),
  };
}

/** Runs an op on the harness table and gives the harness for the next table. */
function run(h: Harness, op: TableOp, row = 0, column = 0): Harness {
  const change = applyTableOp(dataOf(h), { row, column }, op, h.sheet);
  if (!change) throw new Error(`op ${op.op} did not apply`);
  const sheet = change.extra
    ? (((applyPatch({ sheet: h.sheet } as Json, change.extra as JsonObject) as JsonObject).sheet ?? {}) as Sheet)
    : h.sheet;
  return { sheet, table: h.table, widths: change.data.columns.map((c) => c.width) };
}

function grid(rows: number, cols: number, width = 110): Harness {
  const b = new Builder(rows, cols, width);
  b.table = { ...b.table, header: true };
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) b.text(r, c, r === 1 ? `Head ${c}` : `r${r}c${c}`);
  }
  return b.build();
}

async function show(page: Page, h: Harness, wrap = ''): Promise<void> {
  const table = tableHtml('t', h, 'light');
  const body = `<div class="wrapper"><div class="scroller" id="s" style="${wrap}"><div class="ProseMirror">${table}</div></div></div>`;
  await page.setContent(
    `<!doctype html><html data-theme="light"><head><style>${harnessCss()}${scrollerCss()}</style></head><body>${body}</body></html>`,
  );
  await page.evaluate(`${MEASURE_SOURCE}(document.getElementById('t'))`);
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

test('freezing one row keeps the header in view while the table scrolls', async ({ page }) => {
  const frozen = run(grid(40, 4), { op: 'freezeTopRow' });
  expect((frozen.sheet.table as { freeze: { rows: number } }).freeze.rows).toBe(1);
  await show(page, frozen, 'width:300px');
  await page.locator('#s').evaluate((el) => {
    el.scrollTop = 300;
  });
  const scroller = await rect(page, '#s');
  const header = await rect(page, 'tr:nth-child(1) td:nth-child(1)');
  expect(await page.locator('#s').evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(header.top).toBeGreaterThanOrEqual(scroller.top - 0.5);
  expect(header.top).toBeLessThanOrEqual(scroller.top + 1.5);
});

test('a hidden column leaves the layout and shows again with its data', async ({ page }) => {
  const base = grid(3, 4);
  const hidden = run(base, { op: 'hideColumns' }, 1, 1);
  await show(page, hidden);
  const widths = await page
    .locator('tr:nth-child(2) td')
    .evaluateAll((c) => c.map((e) => e.getBoundingClientRect().width));
  expect(widths[1]).toBeLessThan(2);
  expect(await page.locator('table').evaluate((t) => t.getBoundingClientRect().width)).toBeLessThan(400);
  const shown = run(hidden, { op: 'unhideColumns', box: { row1: 0, col1: 0, row2: 0, col2: 2 } });
  await show(page, shown);
  const back = await page
    .locator('tr:nth-child(2) td')
    .evaluateAll((c) => c.map((e) => e.getBoundingClientRect().width));
  expect(back[1]).toBeGreaterThan(80);
  expect(await page.locator('tr:nth-child(2) td:nth-child(2)').innerText()).toBe('r2c2');
});

test('an exact row height is the height, and a minimum height grows with its content', async ({ page }) => {
  const exact = run(grid(3, 2), { op: 'rowHeight', height: 60, exact: true }, 1, 0);
  await show(page, exact);
  expect((await rect(page, 'tr:nth-child(2) td:nth-child(1)')).height).toBeCloseTo(60, 0);
  const minimum = run(grid(3, 2), { op: 'rowHeight', height: 10 }, 1, 0);
  await show(page, minimum);
  expect((await rect(page, 'tr:nth-child(2) td:nth-child(1)')).height).toBeGreaterThan(10);
});

test('a fitted column holds its longest text on one line', async ({ page }) => {
  const b = new Builder(3, 2, 400).text(1, 1, 'Item').text(2, 1, 'Revenue forecast').text(3, 1, 'Cost');
  b.table = { ...b.table, header: true };
  const base = b.build();
  await show(page, base);
  const content = await page.evaluate(() => {
    const p = document.querySelector('tr:nth-child(2) td p') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(p);
    return range.getBoundingClientRect().width;
  });
  // Measured the way the app measures: a canvas with the cell's own font.
  const canvas = await page.evaluate(() => {
    const p = document.querySelector('tr:nth-child(2) td p') as HTMLElement;
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = getComputedStyle(p).font;
    return context.measureText('Revenue forecast').width;
  });
  expect(Math.abs(canvas - content)).toBeLessThan(2);
  const fitted = run(
    base,
    { op: 'fitColumns', measure: (line) => (line.length > 0 ? canvas * (line.length / 16) : 0) },
    0,
    0,
  );
  const width = fitted.widths[0];
  expect(Math.abs(width - (canvas + columnPadding({})))).toBeLessThan(2);
  expect(width).toBe(fitWidth(canvas, columnPadding({})));
  await show(page, fitted);
  const cell = await page.locator('tr:nth-child(2) td:nth-child(1)').evaluate((el) => {
    const p = el.querySelector('p')!;
    return {
      client: el.clientWidth,
      scroll: p.scrollWidth,
      lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
    };
  });
  expect(cell.lines).toBe(1);
  expect(cell.scroll).toBeLessThanOrEqual(cell.client);
});
