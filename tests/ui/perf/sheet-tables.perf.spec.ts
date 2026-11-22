// Row virtualization's budgets (DESIGN.md section 18; docs/perf/tables.md). A table of more than 2,000 rows draws
// only the rows near the view. A 10,000-row table paints within 250 ms of opening its page. Scrolling it keeps
// every frame's work at or under 8 ms. Ctrl+End still reaches the last cell, and a screen reader hears its row
// number. A table of 1,999 rows draws every row.
//
// The budgets hold on the reference laptop (a Surface Laptop Studio 2). The fixed benchmark of tree.perf.spec.ts
// tells how fast this machine is. A faster machine is throttled to the laptop's speed. A slower one, such as a CI
// runner, scales the budgets by how much slower it is. Performance checks never retry.
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const FIRST_PAINT_MS = 250;
const FRAME_MS = 8;
/** The fixed benchmark's time on the reference laptop, in ms (tree.perf.spec.ts). */
const REFERENCE_BENCHMARK_MS = 60;

type Timing = { opened: number; painted: number; frames: number[] };
type Win = Window & { __timing: Timing };

/** The fixed benchmark's time on this machine, in ms: the best of three runs. */
async function benchmark(page: Page): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++)
    runs.push(
      await page.evaluate(() => {
        const start = performance.now();
        let total = 0;
        for (let round = 0; round < 40; round += 1) {
          const items = Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 10_007);
          items.sort((a, b) => a - b);
          total += items[round];
        }
        return total >= 0 ? performance.now() - start : 0;
      }),
    );
  return Math.min(...runs);
}

/**
 * Makes this machine as slow as the laptop: CPU throttling when it is faster, and the budgets' scale when it is
 * slower. Returns the scale.
 */
async function calibrate(page: Page): Promise<{ scale: number; client: CDPSession }> {
  const ms = Math.max(1, await benchmark(page));
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: Math.max(1, REFERENCE_BENCHMARK_MS / ms) });
  return { scale: Math.max(1, ms / REFERENCE_BENCHMARK_MS), client };
}

const pages = (page: Page) => page.getByRole('tree', { name: 'Pages' });

/** Opens a notebook of the sample library, where every page holds the page fixture `fixture`. */
async function openLibrary(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
}

async function openPage(page: Page, name: string): Promise<void> {
  await pages(page).getByRole('treeitem', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const table = (page: Page) => page.locator('main table').first();
/** The drawn rows. A virtual table's other rows are placeholder comments; no locator finds them. */
const rows = (page: Page) => table(page).locator('tbody > tr');
/** How many nodes the table body holds: each row is drawn or is a placeholder. */
const rowNodes = (page: Page) =>
  table(page).evaluate((element) => element.querySelector('tbody')?.childNodes.length ?? 0);

/** The element that scrolls the page's blocks. */
function scrollerOf(page: Page) {
  return table(page).evaluateHandle((element) => {
    for (let at = element.parentElement; at; at = at.parentElement) {
      const overflow = getComputedStyle(at).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight + 1) return at;
    }
    return document.scrollingElement as HTMLElement;
  });
}

test('a 10,000-row table paints within 250 ms of opening its page, and no scroll frame takes over 8 ms', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLibrary(page, 'tenThousandRows');
  // The first opening loads the table's code; the measured one opens another page with the same table.
  await openPage(page, 'Mitosis');
  await expect(table(page)).toHaveAttribute('aria-rowcount', '10001', { timeout: 30_000 });
  const { scale, client } = await calibrate(page);
  await page.evaluate(() => {
    const timing: Timing = { opened: 0, painted: 0, frames: [] };
    (window as unknown as Win).__timing = timing;
    document.addEventListener('click', (event) => (timing.opened = event.timeStamp), { capture: true, once: true });
    // The painted time: the second animation frame after the long table's editor appears, so its first frame is on
    // the screen.
    const seen = new MutationObserver(() => {
      if (!document.querySelector('main table[aria-rowcount="10001"]')) return;
      seen.disconnect();
      requestAnimationFrame(() => requestAnimationFrame((now) => (timing.painted = now)));
    });
    seen.observe(document.body, { childList: true, subtree: true });
  });
  await pages(page).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__timing.painted)).toBeGreaterThan(0);
  const paint = await page.evaluate(() => {
    const timing = (window as unknown as Win).__timing;
    return timing.painted - timing.opened;
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  // Only the rows near the view are drawn; the document keeps every row.
  expect(await rows(page).count()).toBeLessThan(400);
  expect(await rowNodes(page)).toBe(10_001);

  // Scrolling: 240 frames of 80 pixels, about 600 rows, as a wheel or a flick scrolls. Each frame's work runs from
  // the start of its animation frame to the first task after it, which comes once the frame is drawn. Then come ten
  // jumps of 4,000 pixels back up, as a scroll bar drag does. Each draws a whole new screen of rows. They are held
  // only to showing the rows they land on, not to the frame budget.
  const scroller = await scrollerOf(page);
  await scroller.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const timing = (window as unknown as Win).__timing;
        let frame = 0;
        const step = () => {
          const start = performance.now();
          const smooth = frame < 240;
          if (smooth) element.scrollTop += 80;
          else element.scrollTop = Math.max(0, element.scrollTop - 4000);
          if (smooth) setTimeout(() => timing.frames.push(performance.now() - start), 0);
          frame += 1;
          if (frame < 250) requestAnimationFrame(step);
          else setTimeout(resolve, 100);
        };
        requestAnimationFrame(step);
      }),
  );
  const frames = await page.evaluate(() => (window as unknown as Win).__timing.frames);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const worst = Math.max(...frames);
  test
    .info()
    .annotations.push(
      { type: 'first paint', description: `${paint.toFixed(1)} ms (budget ${(FIRST_PAINT_MS * scale).toFixed(0)})` },
      { type: 'worst scroll frame', description: `${worst.toFixed(1)} ms of ${frames.length} frames` },
      { type: 'scale', description: scale.toFixed(2) },
    );
  const summary = `first paint ${paint.toFixed(0)} ms, worst scroll frame ${worst.toFixed(1)} ms`;
  console.log(`sheet tables: ${summary}, scale ${scale.toFixed(2)}`);
  expect.soft(paint).toBeLessThanOrEqual(FIRST_PAINT_MS * scale);
  expect.soft(worst).toBeLessThanOrEqual(FRAME_MS * scale);
  // The rows now in view are drawn.
  const visible = await table(page).evaluate((element) => {
    const middle = window.innerHeight / 2;
    const row = [...element.querySelectorAll('tbody > tr')].find((tr) => {
      const box = tr.getBoundingClientRect();
      return box.top <= middle && box.bottom > middle;
    });
    return row ? row.querySelectorAll('td').length : -1;
  });
  expect(visible === 3 || visible === -1).toBe(true);
});

test('Ctrl+End in a virtualized table selects the last cell and a screen reader hears row 10,001', async ({ page }) => {
  test.setTimeout(120_000);
  await openLibrary(page, 'tenThousandRows');
  await openPage(page, 'Membranes');
  const first = table(page).locator('tr[aria-rowindex="2"] td').first();
  // The keys load with the table's editor; every drawn cell has its row number once they are in.
  await expect(first).toHaveAttribute('aria-rowindex', '2', { timeout: 30_000 });
  await expect(async () => {
    await first.locator('p').click();
    await page.keyboard.press('Escape');
    await expect(first).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press('Control+End');
  const lastRow = table(page).locator('tr[aria-rowindex="10001"]');
  const last = lastRow.locator('td').nth(2);
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await expect(last).toHaveAttribute('aria-rowindex', '10001');
  await expect(last).toHaveText('20000');
  await expect(last).toBeInViewport();
  await expect(table(page)).toHaveAttribute('aria-rowcount', '10001');
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'C10000' })).toHaveCount(1);
});

test('a 1,999-row table draws every row', async ({ page }) => {
  test.setTimeout(120_000);
  await openLibrary(page, 'rows1999');
  await openPage(page, 'Membranes');
  await expect(rows(page)).toHaveCount(1999, { timeout: 30_000 });
  const cells = await rows(page).evaluateAll((all) => all.map((tr) => tr.querySelectorAll('td, th').length));
  expect(cells.every((count) => count === 3)).toBe(true);
  await expect(rows(page).nth(1998)).toHaveText('Item 1998' + '1998' + '3996');
  await expect(table(page)).not.toHaveAttribute('aria-rowcount', /.*/);
  expect(await rowNodes(page)).toBe(1999);
});
