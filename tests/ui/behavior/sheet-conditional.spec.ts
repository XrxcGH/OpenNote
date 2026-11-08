// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling

// Conditional formats drawn in a browser (DESIGN 13.5): a color scale fills cells, a data bar draws a gradient of the
// right width, an icon set draws its glyph before the value with its text for screen readers, and icon only hides
// the value. The table is the HTML the render decorations give (harness.ts), with the real stylesheet.

import type { Page } from '@playwright/test';
import { installConditional } from '../../../app/src/features/tables/sheet/conditional';
import { harnessCss, tableHtml } from '../../../app/src/features/tables/sheet/render/harness';
import type { Harness } from '../../../app/src/features/tables/sheet/render/harness';
import { resolveColor } from '../../../app/src/ui/color/parse';
import { expect, test } from '../fixtures';

installConditional();

const ROW = (n: number) => `01m3sbcmt0000000000000r${String(n).padStart(3, '0')}`;
const COL = '01m3sbcmt0000000000000k001';

function harness(values: number[], rule: object): Harness {
  return {
    sheet: { conditional: { c1: { ranges: [{ col: COL }], order: 1, ...rule } } },
    table: {
      header: false,
      columns: [{ id: COL }],
      rows: values.map((v, i) => ({ id: ROW(i + 1), cells: { [COL]: { markdown: String(v) } } })),
    },
    widths: [120],
  };
}

async function show(page: Page, h: Harness): Promise<void> {
  const head = `<style>${harnessCss()}</style>`;
  const body = `<div>${tableHtml('t', h, 'light')}</div>`;
  await page.setContent(`<!doctype html><html data-theme="light"><head>${head}</head><body>${body}</body></html>`);
}

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test('a color scale fills the cells from its end colors', async ({ page }) => {
  const stops = [
    { at: 'min', color: 'brick' },
    { at: 'max', color: 'fern' },
  ];
  await show(page, harness([1, 5, 10], { type: 'scale', stops }));
  const fill = (row: number) =>
    page.locator(`tr:nth-child(${row}) td`).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await fill(1)).toBe(rgb(resolveColor('brick', 'light') as string));
  expect(await fill(3)).toBe(rgb(resolveColor('fern', 'light') as string));
  expect(await fill(2)).not.toBe(await fill(1));
});

test('a data bar is a gradient that stops at the value share of the cell', async ({ page }) => {
  const bar = { type: 'bar', color: 'indigo', min: { at: 'num', value: '0' }, max: { at: 'num', value: '100' } };
  await show(page, harness([25, 100], bar));
  const image = (row: number) =>
    page.locator(`tr:nth-child(${row}) td`).evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await image(1)).toContain('linear-gradient');
  // The bar ends at 25 percent of the cell; a full bar ends at 100 percent.
  expect(await image(1)).toContain('rgba(0, 0, 0, 0) 25%');
  expect(await image(2)).not.toContain('rgba(0, 0, 0, 0) 25%');
});

test('an icon set draws its glyph before the value, with text for screen readers', async ({ page }) => {
  await show(page, harness([1, 50, 99], { type: 'icons', set: '3Arrows' }));
  const glyph = (row: number) =>
    page.locator(`tr:nth-child(${row}) td > p`).evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await glyph(1)).toContain('▼');
  expect(await glyph(3)).toContain('▲');
  await expect(page.locator('tr:nth-child(1) td')).toHaveAttribute('data-icon-text', 'Down arrow');
  await expect(page.locator('tr:nth-child(2) td')).toHaveAttribute('data-icon-text', 'Sideways arrow');
  await expect(page.locator('tr:nth-child(3) td')).toHaveAttribute('data-icon-text', 'Up arrow');
});

test('icon only hides the value from the eye and keeps it in the page', async ({ page }) => {
  await show(page, harness([1, 99], { type: 'icons', set: '3Arrows', iconOnly: true }));
  const p = page.locator('tr:nth-child(1) td > p');
  expect(await p.evaluate((el) => getComputedStyle(el).color)).toBe('rgba(0, 0, 0, 0)');
  await expect(p).toHaveText('1');
});
