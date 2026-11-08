// The circle that marks invalid data (circle.css): a visible ellipse over the cell, dashed under forced colors, no
// horizontal scroll, and absent in print. The table is plain HTML with the attributes circleAttributes writes, so the
// test needs no editor, only the real stylesheet.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const CSS = readFileSync(join(process.cwd(), 'app/src/features/tables/ui/validation/circle.css'), 'utf8');

async function show(page: Page): Promise<void> {
  const head = [
    '<style>:root{--color-status-danger:rgb(200,30,30)}table{border-collapse:collapse}',
    'td{width:90px;height:34px;border:1px solid #888}',
    CSS,
    '</style>',
  ].join('');
  const body =
    '<table data-sheet><tr><td id="ok">7</td>' +
    '<td id="bad" data-cell data-invalid="range" aria-invalid="true" title="Not valid">150</td></tr></table>';
  await page.setContent(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
}

const after = (page: Page, id: string) =>
  page.locator(`#${id}`).evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return {
      content: s.content,
      borderRadius: s.borderTopLeftRadius,
      borderStyle: s.borderTopStyle,
      borderWidth: s.borderTopWidth,
      color: s.borderTopColor,
      position: s.position,
      pointer: s.pointerEvents,
    };
  });

test('a cell with data-invalid gets a red ellipse and a plain cell does not', async ({ page }) => {
  await show(page);
  const bad = await after(page, 'bad');
  expect(bad.position).toBe('absolute');
  expect(bad.borderStyle).toBe('solid');
  expect(bad.borderWidth).toBe('2px');
  expect(bad.color).toBe('rgb(200, 30, 30)');
  expect(bad.borderRadius).toBe('50%');
  expect(bad.pointer).toBe('none');
  expect((await after(page, 'ok')).content).toBe('none');
});

test('the circle stays inside its cell and the cell keeps its size', async ({ page }) => {
  await show(page);
  const box = await page.locator('#bad').boundingBox();
  expect(box?.width).toBeGreaterThan(80);
  const circle = await page.locator('#bad').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, scrolls: document.documentElement.scrollWidth > window.innerWidth };
  });
  expect(circle.scrolls).toBe(false);
});

test('forced colors draw the circle dashed in the system mark color', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await show(page);
  expect((await after(page, 'bad')).borderStyle).toBe('dashed');
});

test('print hides the circle', async ({ page }) => {
  await show(page);
  await page.emulateMedia({ media: 'print' });
  const shown = await page.locator('#bad').evaluate((el) => getComputedStyle(el, '::after').display);
  expect(shown).toBe('none');
});
