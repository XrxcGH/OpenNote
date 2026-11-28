// Row virtualization's budgets (DESIGN.md section 18; docs/perf/tables.md). A table of more than 2,000 rows draws
// only the rows near the view. A 10,000-row table paints within 250 ms of opening its page. Scrolling it keeps
// the frames' work at or under 8 ms: the 99th percentile of 240 frames, so one stray frame under load does not
// fail, and no frame over twice that. Typing in one of its cells keeps the script time per key at or under 16 ms
// (p95). Ctrl+End still reaches the last cell, and a screen reader hears its row number. A table of 1,999 rows
// draws every row.
//
// The budgets hold on the reference laptop (a Surface Laptop Studio 2). The fixed benchmark of tree.perf.spec.ts
// tells how fast this machine is. A faster machine is throttled to the laptop's speed. A slower one, such as a CI
// runner, scales the budgets by how much slower it is. Performance checks never retry.
//
// The first paint is the median of five opens. Its scale and the scroll frames' scale are the median of six
// benchmark samples: one before each open, and one before the scroll (calibration.ts).
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { installKeyTimer, percentile, readKeys, recordKeys } from '../../perf/typing/keyTimer';
import {
  FRAME_MS,
  REFERENCE_BENCHMARK_MS,
  WORST_FRAME_MS,
  median,
  paintBudget,
  scaleOf,
  throttleRate,
} from './calibration';

/** The typing budget: the script time per key, at the 95th percentile (perf/typing). */
const TYPING_MS = 16;

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
  const ms = await benchmark(page);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: throttleRate(ms) });
  return { scale: scaleOf([ms]), client };
}

/**
 * Starts the first paint's timer. It runs from the next click to the second animation frame after a new 10,000-row
 * table appears, so the table's first frame is on the screen. The page that was open has such a table too. So the
 * timer waits for a table element that was not there before, and no other change in the page stops it.
 */
async function startPaintTimer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const before = document.querySelector('main table');
    const timing: Timing = { opened: 0, painted: 0, frames: [] };
    (window as unknown as Win).__timing = timing;
    document.addEventListener('click', (event) => (timing.opened = event.timeStamp), { capture: true, once: true });
    const seen = new MutationObserver(() => {
      const table = document.querySelector('main table[aria-rowcount="10001"]');
      if (!table || table === before) return;
      seen.disconnect();
      requestAnimationFrame(() => requestAnimationFrame((now) => (timing.painted = now)));
    });
    seen.observe(document.body, { childList: true, subtree: true });
  });
}

/** The first paint the timer measured, in ms, once the new table's second frame is drawn. */
async function readPaint(page: Page): Promise<number> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__timing.painted), { timeout: 30_000 })
    .toBeGreaterThan(0);
  return page.evaluate(() => {
    const timing = (window as unknown as Win).__timing;
    return timing.painted - timing.opened;
  });
}

const pages = (page: Page) => page.getByRole('tree', { name: 'Pages' });

/**
 * Opens each of MEASURED_PAGES from the tree and times its first paint. The benchmark runs before each open and once
 * after the last, under the same load as the opens. Returns the paints and the benchmark samples, in ms.
 */
async function timeOpens(page: Page): Promise<{ paints: number[]; benchmarks: number[] }> {
  const paints: number[] = [];
  const benchmarks: number[] = [];
  for (const name of MEASURED_PAGES) {
    benchmarks.push(await benchmark(page));
    await startPaintTimer(page);
    await pages(page).getByRole('treeitem', { name }).click();
    paints.push(await readPaint(page));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }
  benchmarks.push(await benchmark(page));
  return { paints, benchmarks };
}

/** The page opened first, which loads the table's code. */
const WARM_UP_PAGE = 'Mitosis';
/** The pages the first paint is timed on, in order: each holds the same 10,000-row table. */
const MEASURED_PAGES = ['Membranes', 'Meiosis', 'Photosynthesis', 'Cell structure', 'Membranes'];

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

test('a 10,000-row table paints within 250 ms of opening its page, and its scroll frames take 8 ms or less', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openLibrary(page, 'tenThousandRows');
  // The first opening loads the table's code; the measured ones open other pages with the same table.
  await openPage(page, WARM_UP_PAGE);
  await expect(table(page)).toHaveAttribute('aria-rowcount', '10001', { timeout: 30_000 });
  const { client } = await calibrate(page);
  const { paints, benchmarks } = await timeOpens(page);
  const scale = scaleOf(benchmarks);
  const paint = median(paints);
  // A click comes before its table: a paint of 0 ms or less is a broken timer, not a fast table.
  expect(Math.min(...paints)).toBeGreaterThan(0);
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
          element.scrollTop += 80;
          setTimeout(() => timing.frames.push(performance.now() - start), 0);
          frame += 1;
          if (frame < 240) requestAnimationFrame(step);
          else setTimeout(resolve, 100);
        };
        requestAnimationFrame(step);
      }),
  );
  // Each jump shows its rows within two frames: a drawn row covers the middle of the screen, unless the table does
  // not reach it. A blank gap there fails.
  const blank = await scroller.evaluate(async (element) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const table = document.querySelector('main table')!;
    const misses: number[] = [];
    for (let jump = 0; jump < 10; jump += 1) {
      element.scrollTop = Math.max(0, element.scrollTop - 4000);
      await frame();
      await frame();
      await frame();
      const middle = window.innerHeight / 2;
      const box = table.getBoundingClientRect();
      if (box.top > middle || box.bottom <= middle) continue;
      const covered = [...table.querySelectorAll('tbody > tr')].some((tr) => {
        const row = tr.getBoundingClientRect();
        return row.top <= middle && row.bottom > middle;
      });
      if (!covered) misses.push(element.scrollTop);
    }
    return misses;
  });
  const frames = await page.evaluate(() => (window as unknown as Win).__timing.frames);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const worst = Math.max(...frames);
  const p99 = percentile(frames, 99);
  const budget = paintBudget(scale);
  test.info().annotations.push(
    {
      type: 'first paint',
      description: `median ${paint.toFixed(1)} ms of ${paints.length} opens (budget ${budget.toFixed(0)})`,
    },
    { type: 'scroll frame p99', description: `${p99.toFixed(1)} ms of ${frames.length} frames` },
    { type: 'worst scroll frame', description: `${worst.toFixed(1)} ms` },
    { type: 'scale', description: `${scale.toFixed(2)}, the median of ${benchmarks.length} benchmarks` },
  );
  const opens = paints.map((ms) => ms.toFixed(0)).join(' ');
  const samples = benchmarks.map((ms) => (ms / REFERENCE_BENCHMARK_MS).toFixed(2)).join(' ');
  const scroll = `scroll frame p99 ${p99.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`;
  const first = `first paint ${paint.toFixed(0)} ms (${opens})`;
  console.log(`sheet tables: ${first}, ${scroll}, scale ${scale.toFixed(2)} (${samples})`);
  expect.soft(paint).toBeLessThanOrEqual(budget);
  expect.soft(p99).toBeLessThanOrEqual(FRAME_MS * scale);
  expect.soft(worst).toBeLessThanOrEqual(WORST_FRAME_MS * scale);
  // Every jump landed on drawn rows.
  expect(blank).toEqual([]);
});

test("the first paint's timer waits for the new page's table, not the open page's", async ({ page }) => {
  test.setTimeout(120_000);
  await openLibrary(page, 'tenThousandRows');
  await openPage(page, WARM_UP_PAGE);
  await expect(table(page)).toHaveAttribute('aria-rowcount', '10001', { timeout: 30_000 });
  await startPaintTimer(page);
  // A change in the page while the open page's table is still there, as a late render makes before the click. The
  // old timer stopped on it, and timed a paint of 0 ms or less.
  await page.evaluate(async () => {
    const stray = document.body.appendChild(document.createElement('div'));
    stray.remove();
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let count = 0; count < 3; count += 1) await frame();
  });
  expect(await page.evaluate(() => (window as unknown as Win).__timing.painted)).toBe(0);
  await pages(page).getByRole('treeitem', { name: 'Membranes' }).click();
  expect(await readPaint(page)).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
});

test('typing in a cell of a 10,000-row table keeps the script time per key at or under 16 ms', async ({ page }) => {
  test.setTimeout(120_000);
  await installKeyTimer(page);
  await openLibrary(page, 'tenThousandRows');
  await openPage(page, 'Membranes');
  const cell = table(page).locator('tr[aria-rowindex="2"] td').first();
  await expect(cell).toHaveAttribute('aria-rowindex', '2', { timeout: 30_000 });
  await cell.locator('p').click();
  const { scale, client } = await calibrate(page);
  await recordKeys(page, true);
  // Forty keys, 120 ms apart, as the typing benchmark types them.
  for (const key of 'cells divide in the long table of stages.'.slice(0, 40)) {
    await page.keyboard.type(key);
    await page.waitForTimeout(120);
  }
  await recordKeys(page, false);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const { script, painted, longFrames } = await readKeys(page);
  const p95 = percentile(script, 95);
  test
    .info()
    .annotations.push(
      { type: 'typing script p95', description: `${p95.toFixed(1)} ms of ${script.length} keys` },
      { type: 'typing painted p95', description: `${percentile(painted, 95).toFixed(1)} ms` },
      { type: 'frames over 50 ms', description: String(longFrames) },
      { type: 'scale', description: scale.toFixed(2) },
    );
  console.log(
    `sheet tables: typing script p95 ${p95.toFixed(1)} ms, ${longFrames} long frames, scale ${scale.toFixed(2)}`,
  );
  expect(script.length).toBeGreaterThanOrEqual(30);
  await expect(cell).toContainText('cells divide');
  expect(p95).toBeLessThanOrEqual(TYPING_MS * scale);
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
  await expect(table(page)).toHaveAttribute('aria-rowcount', '1999');
  expect(await rowNodes(page)).toBe(1999);
});
