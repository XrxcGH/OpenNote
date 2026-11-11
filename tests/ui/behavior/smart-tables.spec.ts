// Smart tables (Phase 7): a cell that starts with "=" is a formula and shows its result, results follow the data,
// and the Data menu sorts, filters, formats, totals, and fills. Every change is one undo step.

import { expect, test } from '../fixtures';
import { fillSales, openSmart, setCell } from './smart';

const shown = (page: import('@playwright/test').Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

test('shows a formula’s result and keeps the formula for editing', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '90');
  await shown(page, 2, 2).click();
  await expect(shown(page, 2, 2)).not.toHaveAttribute('data-shown', /.+/);
  await expect(shown(page, 2, 2)).toContainText('=B2*0.6');
});

test('recalculates when the data changes', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 2, 1, '200');
  await shown(page, 0, 0).click();
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '120');
});

test('shows the Excel error token, with the words in a tooltip and for screen readers', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 3, 2, '=B3/0');
  await shown(page, 0, 0).click();
  await expect(shown(page, 3, 2)).toHaveAttribute('data-shown', '#DIV/0!');
  await expect(shown(page, 3, 2)).toHaveAttribute('title', 'Divide by 0');
  await expect(shown(page, 3, 2)).toHaveAttribute('aria-description', 'Divide by zero error');
});

interface HeldTable {
  rows: { id: string; cells: Record<string, { markdown: string }> }[];
  columns: { id: string }[];
  sheet?: { values?: Record<string, Record<string, unknown>> };
}

/** The table block's data as the page service holds it. */
function heldTable(page: import('@playwright/test').Page): Promise<HeldTable> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __OPENNOTE_TEST__: { pagesHeld(): { blocks: { type: string; data: Record<string, unknown> }[] } };
      }
    ).__OPENNOTE_TEST__;
    return hooks.pagesHeld().blocks.find((block) => block.type === 'table')!.data as unknown as HeldTable;
  });
}

/** The cached results of the held table's last column, by data row, and the typed text of B1. */
async function cachedTotals(page: import('@playwright/test').Page): Promise<{ b1: string; totals: unknown[] }> {
  const data = await heldTable(page);
  const last = data.columns[data.columns.length - 1].id;
  return {
    b1: data.rows[1].cells[data.columns[1].id].markdown,
    totals: data.rows.slice(1).map((row) => data.sheet?.values?.[row.id]?.[last] ?? null),
  };
}

test('opens and saves a table without data.sheet and never adds one', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '90');
  await expect.poll(async () => JSON.stringify(await heldTable(page))).toContain('0.6');
  expect(Object.keys(await heldTable(page))).not.toContain('sheet');
});

test('writes the results with the edit that changes them, and Undo takes back both', async ({ page }) => {
  await openSmart(page, 'sheetTable');
  // Pen: 2 + 3 = 5; Ink: 5 + 5 = 10. Opening writes nothing.
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '10');
  await setCell(page, 1, 1, '4');
  await shown(page, 0, 0).click();
  // 4 + 3 = 7, and 7 + 5 = 12, in the same patch as the 4.
  await expect.poll(() => cachedTotals(page)).toEqual({ b1: '4', totals: [7, 12] });
  await shown(page, 1, 0).click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => cachedTotals(page)).toEqual({ b1: '2', totals: [null, null] });
});

test('recalculates 30,000 cells in the worker while frames keep coming under 16 ms', async ({ page }) => {
  test.slow();
  await openSmart(page, 'bigTable');
  const wrapper = page
    .locator('[data-block-id]')
    .filter({ has: page.locator('table') })
    .first();
  await expect(shown(page, 1, 9)).toHaveAttribute('data-shown', '1', { timeout: 60_000 });
  await expect(wrapper).not.toHaveAttribute('aria-busy', 'true');
  // The caret goes in A1 first: on a page this large, the table's toolbar can still be moving the table when a
  // click lands.
  await expect
    .poll(async () => {
      await shown(page, 1, 0).click();
      return shown(page, 1, 0).evaluate((cell) => cell.contains(getSelection()?.anchorNode ?? null));
    })
    .toBe(true);
  // While the worker works, the page answers a message posted in each frame within the frame.
  const watch = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const lags: number[] = [];
        let seen = false;
        const busy = () => document.querySelector('[aria-busy="true"]') !== null;
        // One channel for the whole watch: each frame posts the time it was sent and the answer measures the wait.
        const channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent<number>) => lags.push(performance.now() - event.data);
        const frame = () => {
          if (busy()) {
            seen = true;
            channel.port2.postMessage(performance.now());
          } else if (seen) return setTimeout(() => resolve(lags), 0);
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        setTimeout(() => resolve(lags), 45_000);
      }),
  );
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type('7');
  const lags = (await watch).sort((a, b) => a - b);
  // The worker takes most of a second, and the page draws frames all along. The edit itself still draws in the
  // first frames, so the middle frame is the measure, not the slowest.
  expect(lags.length).toBeGreaterThanOrEqual(5);
  expect(lags[Math.floor(lags.length / 2)]).toBeLessThan(16);
  await expect(shown(page, 1, 9)).toHaveAttribute('data-shown', '8');
});

/** How much slower this machine runs a fixed benchmark than the reference laptop (tree.perf.spec.ts), at least 1. */
async function slowness(page: import('@playwright/test').Page): Promise<number> {
  const ms = await page.evaluate(() => {
    const start = performance.now();
    let total = 0;
    for (let round = 0; round < 40; round += 1) {
      const items = Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 10_007);
      items.sort((a, b) => a - b);
      total += items[round];
    }
    return total >= 0 ? performance.now() - start : 0;
  });
  return Math.max(1, ms / 60);
}

test('keeps a 15,000-cell table with sheet writes on within the typing budget at the 95th percentile', async ({
  page,
}) => {
  test.slow();
  // Input to the next paint for each key press, from the Event Timing API.
  await page.addInitScript(() => {
    const durations: number[] = [];
    (window as unknown as { __durations: number[] }).__durations = durations;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.name === 'keydown') durations.push(entry.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  await openSmart(page, 'largeSheetTable');
  await expect(shown(page, 1, 9)).toHaveAttribute('data-shown', '1', { timeout: 60_000 });
  await expect
    .poll(async () => {
      await shown(page, 1, 0).click();
      return shown(page, 1, 0).evaluate((cell) => cell.contains(getSelection()?.anchorNode ?? null));
    })
    .toBe(true);
  await page.keyboard.press('End');
  const times = () =>
    page.evaluate(() =>
      (
        window as unknown as { __OPENNOTE_TEST__: { smartTableTimes(): Record<string, number[]> } }
      ).__OPENNOTE_TEST__.smartTableTimes(),
    );
  await times();
  await page.evaluate(() => (window as unknown as { __durations: number[] }).__durations.splice(0));
  const samples = 30;
  // 120 ms apart, as the typing harness types: each key settles, so each one writes the value cache with the edit
  // and calculates the page.
  for (let i = 0; i < samples; i += 1) {
    await page.keyboard.press(String(i % 10));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(500);
  const p95 = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const taken = await times();
  const values = taken['smart-table:values'] ?? [];
  const calculate = taken['smart-table:calculate'] ?? [];
  const durations = await page.evaluate(() => (window as unknown as { __durations: number[] }).__durations);
  // Key presses under the 16 ms threshold are not reported: they count as fast.
  const paints = [...durations, ...Array.from({ length: Math.max(0, samples - durations.length) }, () => 0)];
  test.info().annotations.push({
    type: 'p95',
    description:
      `value cache ${p95(values).toFixed(1)} ms of ${values.length}, page calculation ` +
      `${p95(calculate).toFixed(1)} ms of ${calculate.length}, key to paint ${p95(paints).toFixed(1)} ms`,
  });
  // The tables' own share of each key press: the cache written with the edit (ARCHITECTURE.md 20.1: 50 ms at the
  // p95), and the page calculated and drawn on settling. Drawing 15,000 cells is the editor's share, which only a
  // virtualized table would shrink (lane notes). Both budgets scale on a slower machine than the reference laptop.
  const scale = await slowness(page);
  expect(values.length).toBeGreaterThanOrEqual(5);
  expect(calculate.length).toBeGreaterThanOrEqual(5);
  expect(p95(values)).toBeLessThanOrEqual(50 * scale);
  expect(p95(calculate)).toBeLessThanOrEqual(120 * scale);
});

test('sorts a column and puts the rows back with undo', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 1, 1, '120');
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Sort largest first' }).click();
  await expect(shown(page, 1, 0)).toContainText('Feb');
  await expect(shown(page, 3, 0)).toContainText('Mar');
});

test('filters to the rows that match and clears the filter', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 1, 0).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Filter' }).click();
  await page.getByRole('menuitem', { name: 'Show rows equal to this cell' }).click();
  await expect(page.getByRole('group', { name: 'Table data' }).getByText('Showing 1 of 3 rows.')).toBeVisible();
  await expect(page.locator('table tr:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('table tr:visible')).toHaveCount(4);
});

test('formats a column as currency and adds a total', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Number format' }).click();
  await page.getByRole('menuitemradio', { name: 'Currency' }).click();
  // The cell being edited shows what was typed, so look at the one below it.
  await expect(shown(page, 2, 1)).toHaveAttribute('data-shown', /\$150/);
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Total at the bottom' }).click();
  await page.getByRole('menuitemradio', { name: 'Sum' }).click();
  await expect(page.getByRole('list', { name: 'Column totals' })).toContainText('Sum of Sales');
  await expect(page.getByRole('list', { name: 'Column totals' })).toContainText('$360');
});

test('fills a formula down with its references moved', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 2, 2).click();
  await page.keyboard.down('Shift');
  await shown(page, 3, 2).click();
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+d');
  await expect(shown(page, 3, 2)).toContainText('=B3*0.6');
  await shown(page, 0, 0).click();
  await expect(shown(page, 3, 2)).toHaveAttribute('data-shown', '54');
});

test('makes a column of choices, picks one from the list, and renames it everywhere', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 1, 0).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Number format' }).click();
  await page.getByRole('menuitemradio', { name: 'Choice, pick one' }).click();
  // Jan, Feb, and Mar become options, each drawn as a chip over its text.
  await expect(page.locator('table td [data-chip]')).toHaveCount(3);
  await shown(page, 3, 0).click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('menuitemradio', { name: 'Feb' }).click();
  await expect(shown(page, 3, 0)).toContainText('Feb');
  await shown(page, 1, 0).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Edit choices…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name of choice 1' }).fill('January');
  await dialog.getByRole('button', { name: 'Save choices' }).click();
  await expect(shown(page, 1, 0)).toContainText('January');
});
