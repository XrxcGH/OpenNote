// Hold-to-shape in the app, with hand-drawn strokes: every shape the recognizer knows, drawn by the hand model of
// app/src/features/ink/geometry/shapes/handDrawn.ts and sent through the DevTools Protocol as a pen at the hand's own
// pace. The pen is held still at the end until the stroke snaps, then lifted. The test reads the stored stroke and
// names its shape the way the app does to give a shape its handles. It saves a 4x crop of each shape for a person to
// look at, in OPENNOTE_INK_CROPS.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { seededRandom } from '../../../app/src/features/ink/geometry/fixtures';
import { draw } from '../../../app/src/features/ink/geometry/shapes/corpus/hand';
import { SHAPES } from '../../../app/src/features/ink/geometry/shapes/corpus/shapes';
import { NOT_SHAPES } from '../../../app/src/features/ink/geometry/shapes/corpus/writing';
import { recognizeShape } from '../../../app/src/features/ink/geometry/shapes/recognize';
import { shapeCorpus, type Drawing } from '../../../app/src/features/ink/geometry/shapes/handDrawn';
import { expect, test } from '../fixtures';
import { choose, openPage } from '../ink';
import { storedStrokes } from '../paperSnap';

const OUT = process.env.OPENNOTE_INK_CROPS ?? join(import.meta.dirname, '..', 'results', 'ink-quality');
const HOLD_MS = 500;

test.use({
  boot: { settings: { ink: { shapes: { hold: true, holdMs: HOLD_MS, inkToShape: false } } } } as never,
  viewport: { width: 1600, height: 1000 },
  // The crops are rendered at 4x, not a 1x bitmap scaled up, so they show whether corners are crisp and outlines close.
  deviceScaleFactor: 4,
});

/** The time channel's bit in a stored stroke: a shape is stored without one. */
const CHANNEL_TIME = 4;

function channelsOf(): Record<string, number> {
  const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
  const held = hooks.pagesHeld() as { memoryInk?: Record<string, { id: string; channels: number }> };
  return Object.fromEntries(Object.values(held.memoryInk ?? {}).map((s) => [s.id, s.channels]));
}

/**
 * Draws one drawing with the pen at its own pace, centered at `at` (window pixels), holds still, and lifts; or lifts at
 * once when `hold` is false.
 */
async function drawHeld(
  client: CDPSession,
  page: Page,
  d: Pick<Drawing, 'points'>,
  at: { x: number; y: number },
  zoom: number,
  hold = true,
) {
  const xs = d.points.map((p) => p.x);
  const ys = d.points.map((p) => p.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const toWindow = (p: { x: number; y: number }) => ({ x: at.x + (p.x - c.x) * zoom, y: at.y + (p.y - c.y) * zoom });
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: { x: number; y: number }, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      ...toWindow(p),
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
      force: buttons ? 0.5 : 0,
    });
  const start = Date.now();
  await send('mousePressed', d.points[0], 1);
  for (const p of d.points.slice(1)) {
    const wait = start + p.time - Date.now();
    if (wait > 1) await page.waitForTimeout(wait);
    await send('mouseMoved', p, 1);
  }
  if (hold) await page.waitForTimeout(HOLD_MS + 300);
  await send('mouseReleased', d.points[d.points.length - 1], 0);
  return { box: d.points.map(toWindow) };
}

/** A 4x crop around a drawing, for a person to look at. */
async function crop(client: CDPSession, page: Page, name: string, box: { x: number; y: number }[]) {
  const xs = box.map((p) => p.x);
  const ys = box.map((p) => p.y);
  const clip = {
    x: Math.min(...xs) - 16,
    y: Math.min(...ys) - 16,
    width: Math.max(...xs) - Math.min(...xs) + 32,
    height: Math.max(...ys) - Math.min(...ys) + 32,
    scale: 4,
  };
  await page.waitForTimeout(300);
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `shape-${name.replace(/ /g, '-')}.png`), Buffer.from(data, 'base64'));
}

test('hand-drawn shapes held to snap come back as the shape the hand meant', async ({ page, context }) => {
  test.setTimeout(900_000);
  const only = process.env.OPENNOTE_HAND_ONLY?.split(',');
  const drawings = shapeCorpus(Number(process.env.OPENNOTE_HAND_COUNT ?? 2), 'hold', 7).filter(
    (d) => !only || only.includes(d.name),
  );
  const client = await context.newCDPSession(page);
  const results: string[] = [];
  const cropped = new Set<string>();
  let right = 0;
  for (const d of drawings) {
    // A fresh page for each drawing, so no shape before it can catch a connector's end.
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const at = { x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height / 2 };
    const before = new Set((await page.evaluate(storedStrokes)).map((s) => s.id));
    const { box } = await drawHeld(client, page, d, at, 1);
    await expect
      .poll(async () => (await page.evaluate(storedStrokes)).length, { timeout: 60_000 })
      .toBe(before.size + 1);
    const stroke = (await page.evaluate(storedStrokes)).find((s) => !before.has(s.id))!;
    const exact = ((await page.evaluate(channelsOf))[stroke.id] & CHANNEL_TIME) === 0;
    // As the app reads a shape back for its handles (shapeOfStroke): two points are a line, and the rest are named.
    const named = () => recognizeShape(stroke.points, { minSize: 1, extra: true })?.shape.kind ?? '?';
    const kind = !exact ? 'ink' : stroke.points.length === 2 ? 'line' : named();
    if (kind === d.expect) right++;
    results.push(`${d.name}: ${kind}`);
    if (!cropped.has(d.name) && kind === d.expect) {
      cropped.add(d.name);
      await crop(client, page, d.name, box);
    }
  }
  console.info(results.join('\n'));
  expect(right / drawings.length, results.join('; ')).toBeGreaterThanOrEqual(0.95);
});

test.describe('with ink-to-shape on', () => {
  test.use({ boot: { settings: { ink: { shapes: { hold: false, inkToShape: true } } } } as never });

  /** One stroke written by the hand: a letter or a shape from the corpus, `size` units across, sampled at 60 Hz. */
  const written = (name: string, size: number, seed: number) => {
    const spec = [...NOT_SHAPES, ...SHAPES].find((s) => s.name === name)!;
    const r = seededRandom(seed);
    return { points: draw(r, spec.make(r, size), size, 60, 'lift', !name.startsWith('letter'), 1) };
  };

  test('letters written at note size stay ink, beside other writing too, and a circle still snaps', async ({
    page,
    context,
  }) => {
    const client = await context.newCDPSession(page);
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const at = (dx: number, dy: number) => ({ x: overlay.x + overlay.width / 2 + dx, y: overlay.y + 200 + dy });
    const exact = async () => {
      const channels = await page.evaluate(channelsOf);
      return (await page.evaluate(storedStrokes)).map((s) => (channels[s.id] & CHANNEL_TIME) === 0);
    };
    const add = async (d: { points: { x: number; y: number; time: number }[] }, where: { x: number; y: number }) => {
      const count = (await page.evaluate(storedStrokes)).length;
      await drawHeld(client, page, d, where, 1, false);
      await expect.poll(async () => (await page.evaluate(storedStrokes)).length, { timeout: 30_000 }).toBe(count + 1);
      return (await exact())[count];
    };
    // An o 26 units tall and an l 36 tall, written quickly: small and quick, so ink.
    const o = written('letter o', 26, 3);
    const l = written('letter l', 36, 4);
    expect(o.points[o.points.length - 1].time).toBeLessThan(250);
    expect(await add(o, at(-300, 0)), 'a note-size o').toBe(false);
    expect(await add(l, at(-250, 0)), 'a note-size l').toBe(false);
    // A heading's O, 60 units tall, after an S as tall to its left: in a line of writing, so ink.
    expect(await add(written('letter S', 60, 5), at(-100, 200)), 'a heading S').toBe(false);
    expect(await add(written('letter O', 60, 6), at(-40, 200)), 'a heading O beside the S').toBe(false);
    // A circle 120 across on its own is a shape.
    expect(await add(written('circle', 120, 7), at(250, 300)), 'a circle').toBe(true);
  });
});
