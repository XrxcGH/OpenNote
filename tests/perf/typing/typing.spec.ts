// Typing latency in a page (ADR 0005's in-page measure): the time from each keydown's time stamp to a message posted
// from the next requestAnimationFrame, which runs after style, layout, and paint. Keys come 120 ms apart, 100 of
// them after 10 warm-up keys, on a freshly loaded page. WP0 records the numbers; WP8 turns them into the gate.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const WARM_UP = 10;
const KEYS = 100;
const GAP_MS = 120;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

test('types into the short fixture and records keydown to the next frame', async ({ page }) => {
  await page.goto('/?fixture=short');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.press('End');
  await page.evaluate(() => {
    const times: number[] = [];
    (window as unknown as { __typingTimes: number[] }).__typingTimes = times;
    document.addEventListener(
      'keydown',
      (event) => requestAnimationFrame(() => setTimeout(() => times.push(performance.now() - event.timeStamp), 0)),
      { capture: true },
    );
  });
  for (let i = 0; i < WARM_UP + KEYS; i += 1) {
    await page.keyboard.press('a');
    await page.waitForTimeout(GAP_MS);
  }
  const times = await page.evaluate(() => (window as unknown as { __typingTimes: number[] }).__typingTimes);
  const measured = times.slice(WARM_UP).sort((a, b) => a - b);
  expect(measured).toHaveLength(KEYS);
  const report = { fixture: 'short', keys: KEYS, p50: percentile(measured, 50), p95: percentile(measured, 95) };
  const dir = join(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'typing.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Typing on the short fixture: p50 ${report.p50.toFixed(1)} ms, p95 ${report.p95.toFixed(1)} ms`);
});
