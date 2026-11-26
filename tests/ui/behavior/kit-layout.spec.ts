// The kit windows' layout, measured in the browser. No select clips its chosen option. The civil table hint keeps
// the shared gap below its box. Three tools open at once at 1280 never cover one another.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openSmart } from './smart';

async function openTool(page: Page, id: string) {
  await page.evaluate((tool) => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, (id: string) => void> }).__OPENNOTE_TEST__;
    hooks.openTool!(tool);
  }, id);
  await expect(page.locator(`[data-tool=${id}]`)).toBeVisible();
}

/** The selects of a tool window whose chosen option is wider than the select. */
const clipped = (page: Page, id: string) =>
  page.evaluate(
    (tool) =>
      [...document.querySelectorAll<HTMLSelectElement>(`[data-tool=${tool}] select`)]
        .filter((select) => select.scrollWidth > select.clientWidth)
        .map((select) => `${select.id}: ${select.scrollWidth} > ${select.clientWidth}`),
    id,
  );

for (const width of [1280, 820]) {
  test(`no select in the thermodynamics or civil kit is clipped at ${width}`, async ({ page }) => {
    await openSmart(page);
    await page.setViewportSize({ width, height: 800 });
    await openTool(page, 'kit-thermo');
    const thermo = page.locator('[data-tool=kit-thermo]');
    expect(await clipped(page, 'kit-thermo')).toEqual([]);
    for (const tab of await thermo.getByRole('tab').all()) {
      await tab.click();
      expect(await clipped(page, 'kit-thermo')).toEqual([]);
    }
    await openTool(page, 'kit-civil');
    const civil = page.locator('[data-tool=kit-civil]');
    const tools = civil.locator('select').first();
    const options = tools.locator('option');
    const values = await options.evaluateAll((all) => all.map((one) => (one as HTMLOptionElement).value));
    for (const value of values) {
      await tools.selectOption(value);
      expect(await clipped(page, 'kit-civil'), value).toEqual([]);
      for (const area of await civil.locator('textarea[aria-describedby]').all()) {
        const gap = await area.evaluate((box) => {
          const hint = document.getElementById(box.getAttribute('aria-describedby')!)!;
          return hint.getBoundingClientRect().top - box.getBoundingClientRect().bottom;
        });
        expect(gap, `${value} hint gap`).toBeGreaterThanOrEqual(4);
      }
    }
  });
}

test('Reference tables, Calculator and Upcoming at 1280 never cover one another', async ({ page }) => {
  await openSmart(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const id of ['reference', 'calculator', 'upcoming']) await openTool(page, id);
  const boxes = await page.evaluate(() =>
    ['reference', 'calculator', 'upcoming'].map((id) => {
      const box = document.querySelector(`[data-tool=${id}]`)!.getBoundingClientRect();
      return { id, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  );
  let overlapping = 0;
  for (let a = 0; a < boxes.length; a += 1)
    for (let b = a + 1; b < boxes.length; b += 1) {
      const one = boxes[a]!;
      const two = boxes[b]!;
      const across = one.left < two.right - 0.5 && two.left < one.right - 0.5;
      const down = one.top < two.bottom - 0.5 && two.top < one.bottom - 0.5;
      if (across && down) overlapping += 1;
    }
  expect(overlapping).toBe(0);
});
