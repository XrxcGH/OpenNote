// The typing benchmark's motion mode (Phase 4 ARCHITECTURE.md section 24.2): zooming and panning the freeform page
// with 8 text boxes, one of them the 20-page note, by mouse wheel, Ctrl+wheel, touch pan, and touch pinch. Each
// gesture records the time of every animation frame while it runs, and reports frames a second, the 95th
// percentile frame interval, and the longest run of dropped frames. The budget is 60 frames a second with never
// two dropped frames in a row; OPENNOTE_TYPING_GATE=1 fails a gesture that drops two in a row. Results go to
// results/motion.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { openFixture } from './conditions';
import { percentile } from './keyTimer';

const RESULTS = join(import.meta.dirname, 'results');
const gate = process.env.OPENNOTE_TYPING_GATE === '1';

interface Gesture {
  id: string;
  description: string;
  run(page: Page, client: CDPSession, center: { x: number; y: number }): Promise<void>;
}

async function wheel(page: Page, center: { x: number; y: number }, dy: number, steps: number) {
  await page.mouse.move(center.x, center.y);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
  }
}

const GESTURES: readonly Gesture[] = [
  {
    id: 'wheel.pan',
    description: 'Mouse wheel scrolling down and up',
    run: async (page, _client, center) => {
      await wheel(page, center, 100, 30);
      await wheel(page, center, -100, 30);
    },
  },
  {
    id: 'wheel.zoom',
    description: 'Ctrl+wheel zooming out and in',
    run: async (page, _client, center) => {
      await page.keyboard.down('Control');
      await wheel(page, center, 100, 15);
      await wheel(page, center, -100, 15);
      await page.keyboard.up('Control');
    },
  },
  {
    id: 'touch.pan',
    description: 'A one-finger touch drag down and back',
    run: async (_page, client, center) => {
      for (const yDistance of [-600, 600]) {
        await client.send('Input.synthesizeScrollGesture', {
          x: center.x,
          y: center.y,
          yDistance,
          speed: 1200,
          gestureSourceType: 'touch',
          repeatCount: 1,
        });
      }
    },
  },
  {
    id: 'touch.pinch',
    description: 'A two-finger pinch out and in',
    run: async (_page, client, center) => {
      for (const scaleFactor of [2, 0.5]) {
        await client.send('Input.synthesizePinchGesture', {
          x: center.x,
          y: center.y,
          scaleFactor,
          relativeSpeed: 400,
          gestureSourceType: 'touch',
        });
      }
    },
  },
];

interface MotionResult {
  id: string;
  description: string;
  frames: number;
  fps: number;
  intervalP95: number;
  dropped: number;
  longestDropRun: number;
}

const results: MotionResult[] = [];

test.describe('motion', () => {
  for (const gesture of GESTURES) {
    test(`${gesture.id}: ${gesture.description}`, async ({ page }) => {
      test.setTimeout(90_000);
      await openFixture(page, 'freeform8');
      await page.waitForTimeout(1_000);
      const client = await page.context().newCDPSession(page);
      // Over the 20-page box, where a person's hand would be.
      const box = (await page.getByRole('textbox', { name: /^Text box 1 / }).boundingBox())!;
      const area = { x: box.x + box.width / 2, y: Math.min(box.y + 300, 600) };
      await page.evaluate(() => {
        const times: number[] = [];
        (window as unknown as { __frames: number[] }).__frames = times;
        const tick = (time: number) => {
          times.push(time);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const start = await page.evaluate(() => performance.now());
      await gesture.run(page, client, area);
      const end = await page.evaluate(() => performance.now());
      const times = await page.evaluate(
        ([from, to]) => (window as unknown as { __frames: number[] }).__frames.filter((t) => t >= from && t <= to),
        [start, end],
      );
      const intervals = times.slice(1).map((time, i) => time - times[i]);
      // Dropped frames count against the budget's 60 Hz display, even on a faster one: a 40 ms gap is two.
      const missed = intervals.map((interval) => Math.max(0, Math.round(interval / (1000 / 60)) - 1));
      const result: MotionResult = {
        id: gesture.id,
        description: gesture.description,
        frames: times.length,
        fps: Number(((times.length - 1) / ((times[times.length - 1] - times[0]) / 1000)).toFixed(1)),
        intervalP95: Number(percentile(intervals, 95).toFixed(1)),
        dropped: missed.reduce((sum, count) => sum + count, 0),
        longestDropRun: Math.max(0, ...missed),
      };
      results.push(result);
      console.log(
        `${gesture.id.padEnd(12)} ${result.fps} fps over ${result.frames} frames, interval p95 ` +
          `${result.intervalP95} ms, ${result.dropped} dropped, at most ${result.longestDropRun} in a row`,
      );
      expect(result.frames).toBeGreaterThan(10);
      if (gate) expect(result.longestDropRun, 'dropped frames in a row').toBeLessThanOrEqual(1);
    });
  }

  test.afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(
      join(RESULTS, 'motion.json'),
      `${JSON.stringify({ when: new Date().toISOString(), gestures: results }, null, 2)}\n`,
    );
  });
});
