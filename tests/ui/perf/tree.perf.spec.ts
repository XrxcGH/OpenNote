// The tree's feedback budget (ARCHITECTURE.md sections 20.1 and 21.10): selecting and arrowing through a
// 1,000-page section stays at or under 50 ms at the 95th percentile, measured with the Event Timing API from
// input to the next paint, under CPU throttling calibrated to the reference laptop. Holding an arrow key doesn't
// open every page it passes. Performance checks never retry.

import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const BUDGET_MS = 50;
const SAMPLES = 40;
/** The fixed benchmark's time on the reference laptop (a Surface Laptop Studio 2), in ms. */
const REFERENCE_BENCHMARK_MS = 60;

test.use({
  fixture: 'large',
  boot: { state: { location: { view: 'workspace', notebookId: 'lg-n-1', sectionId: 'lg-s-1-1', pageId: null } } },
});

/** Runs a fixed benchmark in the page and returns the throttle rate that makes this machine as slow as the laptop. */
async function calibratedRate(page: Page): Promise<number> {
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
  return Math.max(1, REFERENCE_BENCHMARK_MS / Math.max(1, ms));
}

async function throttle(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: await calibratedRate(page) });
  return client;
}

const percentile95 = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

test('arrowing through 1,000 pages answers within the feedback budget', async ({ page }) => {
  await page.addInitScript(() => {
    const durations: number[] = [];
    (window as unknown as { __durations: number[] }).__durations = durations;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.name === 'keydown') durations.push(entry.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
  await page.goto('/');
  const pages = page.getByRole('tree', { name: 'Pages' });
  await pages.getByRole('treeitem').first().focus();
  await throttle(page);
  for (let i = 0; i < SAMPLES; i += 1) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  const durations = await page.evaluate(() => (window as unknown as { __durations: number[] }).__durations);
  // Events under the 16 ms threshold aren't reported; they count as fast.
  const all = [...durations, ...Array.from({ length: Math.max(0, SAMPLES - durations.length) }, () => 0)];
  const p95 = percentile95(all);
  test.info().annotations.push({ type: 'p95', description: `${p95.toFixed(1)} ms of ${SAMPLES} key presses` });
  expect(p95).toBeLessThanOrEqual(BUDGET_MS);
});

test('holding an arrow key opens only the page it stops on', async ({ page }) => {
  await page.goto('/');
  const pages = page.getByRole('tree', { name: 'Pages' });
  await pages.getByRole('treeitem').first().focus();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __headings: string[] }).__headings = seen;
    new MutationObserver(() => {
      const heading = document.querySelector('main h1')?.textContent;
      if (heading && seen[seen.length - 1] !== heading) seen.push(heading);
    }).observe(document.querySelector('main') as Element, { childList: true, subtree: true, characterData: true });
  });
  await page.keyboard.down('ArrowDown');
  for (let i = 0; i < 25; i += 1) await page.keyboard.down('ArrowDown');
  await page.keyboard.up('ArrowDown');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page 27');
  const opened = await page.evaluate(() => (window as unknown as { __headings: string[] }).__headings);
  expect(opened.length).toBeLessThanOrEqual(3);
});
