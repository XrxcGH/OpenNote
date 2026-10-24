// The ink exit gate (docs/perf/phase-5.md): on a page of 10,000 strokes, the time from a pen sample to the frame
// that draws it, and the frame rate while drawing and while scrolling. The production build runs in Chromium with
// the web platform; the mouse stands in for the pen, through the same pointer path. Set OPENNOTE_INK_PERF_OUT to a
// file to write the numbers as JSON. Performance checks never retry.
import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, openPage } from '../ink';

/** Pen-to-screen inside the app: from the sample's timestamp to the start of the frame that shows it. */
const LATENCY_P95_MS = 25;
/** The frame rate while drawing and scrolling, against the display's own rate. */
const MIN_FRAME_SHARE = 0.9;

type Hooks = Record<string, (...args: unknown[]) => unknown>;

const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

/** The display's frame rate with nothing else running, from 60 animation frames. */
function displayRate(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = [];
        const tick = (t: number) => {
          times.push(t);
          if (times.length < 61) requestAnimationFrame(tick);
          else resolve(1000 / ((times[60] - times[0]) / 60));
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function seed(page: Page, count: number, width: number, height: number) {
  const started = Date.now();
  const seeded = await page.evaluate(
    ([c, w, h]) => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.inkSeed(c, w, h),
    [count, width, height],
  );
  expect(seeded).toBe(count);
  return Date.now() - started;
}

/** Reopens the page and waits until the visible tiles are drawn: what opening a page of ink costs. */
async function reopen(page: Page): Promise<number> {
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  const started = Date.now();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.inkStats() as {
          strokes: number;
          drawn: number;
          pending: number;
        } | null;
        return stats !== null && stats.strokes === 10_000 && stats.drawn > 0 && stats.pending === 0;
      }),
    )
    .toBe(true);
  return Date.now() - started;
}

/** Draws a long scribble and records, for every sample, the time to the next frame, and every frame's length. */
async function drawAndTime(page: Page) {
  await page.evaluate(() => {
    const state = { samples: [] as number[], frames: [] as number[], waiting: [] as number[], last: 0, on: true };
    (window as unknown as { __inkTiming: typeof state }).__inkTiming = state;
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons) state.waiting.push(event.timeStamp);
      },
      { capture: true },
    );
    const frame = (t: number) => {
      if (state.last) state.frames.push(t - state.last);
      state.last = t;
      for (const at of state.waiting.splice(0)) state.samples.push(t - at);
      if (state.on) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const box = (await page.locator('[data-ink-overlay]').boundingBox())!;
  for (let stroke = 0; stroke < 6; stroke++) {
    const y = box.y + 150 + stroke * 60;
    await page.mouse.move(box.x + 100, y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(box.x + 100 + i * 6, y + Math.sin(i / 3) * 20);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
  }
  return page.evaluate(() => {
    const state = (window as unknown as { __inkTiming: { samples: number[]; frames: number[]; on: boolean } })
      .__inkTiming;
    state.on = false;
    return { samples: state.samples, frames: state.frames };
  });
}

/** Scrolls the page down and back for two seconds, one step a frame, and returns every frame's length. */
function scrollAndTime(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const scroller = document.querySelector<HTMLElement>('[data-ink-overlay]')!
          .previousElementSibling as HTMLElement;
        const frames: number[] = [];
        let last = 0;
        let step = 12;
        const tick = (t: number) => {
          if (last) frames.push(t - last);
          last = t;
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 || scroller.scrollTop <= 0) {
            step = scroller.scrollTop <= 0 ? 12 : -12;
          }
          scroller.scrollTop += step;
          if (frames.length < 240) requestAnimationFrame(tick);
          else resolve(frames);
        };
        requestAnimationFrame(tick);
      }),
  );
}

const rate = (frames: readonly number[]) => 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length);

for (const density of [
  { name: 'spread', width: 4000, height: 12000 },
  { name: 'dense', width: 1600, height: 4000 },
]) {
  test(`draws and scrolls at the display's rate on a ${density.name} page of 10,000 strokes`, async ({ page }) => {
    test.setTimeout(180_000);
    await openPage(page);
    const display = await displayRate(page);
    const seedMs = await seed(page, 10_000, density.width, density.height);
    const openMs = await reopen(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    const drawing = await drawAndTime(page);
    const before = await page.evaluate(() =>
      (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.inkStats(),
    );
    const scrolling = await scrollAndTime(page);
    const after = await page.evaluate(() =>
      (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.inkStats(),
    );
    const result = {
      density: density.name,
      display: Math.round(display),
      seedMs,
      openMs,
      samples: drawing.samples.length,
      latencyP50: percentile(drawing.samples, 0.5),
      latencyP95: percentile(drawing.samples, 0.95),
      drawFps: rate(drawing.frames),
      drawLongFrames: drawing.frames.filter((f) => f > (1000 / display) * 1.5).length,
      scrollFps: rate(scrolling),
      scrollLongFrames: scrolling.filter((f) => f > (1000 / display) * 1.5).length,
      before,
      after,
    };
    console.log(`ink perf ${JSON.stringify(result)}`);
    const out = process.env.OPENNOTE_INK_PERF_OUT;
    if (out) writeFileSync(`${out}.${density.name}.json`, JSON.stringify(result, null, 2));
    expect(result.latencyP95).toBeLessThanOrEqual(LATENCY_P95_MS);
    expect(result.drawFps).toBeGreaterThanOrEqual(display * MIN_FRAME_SHARE);
    expect(result.scrollFps).toBeGreaterThanOrEqual(display * MIN_FRAME_SHARE);
  });
}
