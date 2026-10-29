// Ink quality on the web platform: a fast pen stroke draws as a smooth curve, and a recognized shape draws with one
// even width and closed, crisp corners. The pen comes through the DevTools Protocol as a pen with pressure, at the
// spacing a 60 Hz and a 120 Hz digitizer gives a fast hand. The window runs at 4 device pixels to the CSS pixel, so
// the tiles and the live canvas hold the ink at 4x, and the test measures the ink they hold. Crops at 4x go to
// OPENNOTE_INK_CROPS, named with OPENNOTE_INK_CROPS_TAG, for a person to look at.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, openPage } from '../ink';
import { storedStrokes } from '../paperSnap';

const OUT = process.env.OPENNOTE_INK_CROPS ?? join(import.meta.dirname, '..', 'results', 'ink-quality');
const TAG = process.env.OPENNOTE_INK_CROPS_TAG ?? 'after';

interface Vec {
  x: number;
  y: number;
}

test.use({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 4 });

/** A pen stroke through window points, with the pressure `force` gives each point. It lifts unless told not to. */
async function pen(client: CDPSession, points: readonly Vec[], force: (i: number) => number, lift = true) {
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Vec, buttons: number, i: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
      force: buttons ? force(i) : 0,
    });
  await send('mousePressed', points[0], 1, 0);
  for (let i = 1; i < points.length; i += 1) await send('mouseMoved', points[i], 1, i);
  if (lift) await send('mouseReleased', points[points.length - 1], 0, points.length - 1);
}

/** A circle drawn in 0.28 s a turn, a little past its start, as a digitizer at `hz` samples it. */
function fastCircle(c: Vec, r: number, hz: number): Vec[] {
  const perTurn = Math.round(0.28 * hz);
  const count = Math.round(perTurn * 1.12);
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / perTurn;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** Cursive loops (a prolate cycloid), five of them, sampled `perLoop` times a loop. */
function loops(at: Vec, perLoop: number): Vec[] {
  const count = 5 * perLoop;
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = (2 * Math.PI * i) / perLoop;
    return { x: at.x + 14 * t - 30 * Math.sin(t), y: at.y - 30 * Math.cos(t) };
  });
}

/**
 * Where the ink's outer edge is, out from `c`, every degree from `from` to `to`: the farthest point within 12 CSS
 * pixels of radius `r` whose ink is at least half opaque, in the canvases `selector` picks. NaN where there is none.
 */
function edgeRadii(args: { c: Vec; r: number; from: number; to: number; selector: string }): number[] {
  const tiles = [...document.querySelectorAll<HTMLCanvasElement>(args.selector)]
    .filter((canvas) => canvas.style.display !== 'none' && canvas.width > 0)
    .map((canvas) => ({
      canvas,
      rect: canvas.getBoundingClientRect(),
      data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
    }));
  const alpha = (x: number, y: number) => {
    for (const { canvas, rect, data } of tiles) {
      if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) continue;
      const px = Math.floor(((x - rect.left) * canvas.width) / rect.width);
      const py = Math.floor(((y - rect.top) * canvas.height) / rect.height);
      const a = data[(py * canvas.width + px) * 4 + 3];
      if (a > 0) return a;
    }
    return 0;
  };
  const out: number[] = [];
  for (let deg = args.from; deg <= args.to; deg += 1) {
    const a = (deg * Math.PI) / 180;
    let edge = Number.NaN;
    for (let d = args.r + 12; d >= args.r - 12; d -= 0.125) {
      if (alpha(args.c.x + d * Math.cos(a), args.c.y + d * Math.sin(a)) >= 128) {
        edge = d;
        break;
      }
    }
    out.push(edge);
  }
  return out;
}

/** How thick the ink is across a line at each of `at`, along the normal `n`, in CSS pixels. */
function thickness(args: { at: Vec[]; n: Vec; selector: string }): number[] {
  const tiles = [...document.querySelectorAll<HTMLCanvasElement>(args.selector)]
    .filter((canvas) => canvas.style.display !== 'none' && canvas.width > 0)
    .map((canvas) => ({
      canvas,
      rect: canvas.getBoundingClientRect(),
      data: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
    }));
  const alpha = (x: number, y: number) => {
    for (const { canvas, rect, data } of tiles) {
      if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) continue;
      const px = Math.floor(((x - rect.left) * canvas.width) / rect.width);
      const py = Math.floor(((y - rect.top) * canvas.height) / rect.height);
      const a = data[(py * canvas.width + px) * 4 + 3];
      if (a > 0) return a;
    }
    return 0;
  };
  return args.at.map((p) => {
    let inked = 0;
    for (let d = -16; d <= 16; d += 0.125) if (alpha(p.x + args.n.x * d, p.y + args.n.y * d) >= 128) inked += 0.125;
    return inked;
  });
}

async function crop(client: CDPSession, name: string, box: { x: number; y: number; width: number; height: number }) {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 4 } });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${TAG}-${name}.png`), Buffer.from(data, 'base64'));
}

async function strokeCount(page: Page): Promise<number> {
  return (await page.evaluate(storedStrokes)).length;
}

const TILES = '[data-ink-tiles] canvas';
const LIVE = '[data-ink-live]';

test.describe('freehand ink', () => {
  test.use({ boot: { settings: { ink: { shapes: { hold: false, inkToShape: false } } } } as never });

  test('a fast circle at 60 and at 120 Hz draws round, while the pen is down and after it lifts', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    const client = await context.newCDPSession(page);
    const box = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const r = 80;
    for (const [k, hz] of [60, 120].entries()) {
      const c = { x: box.x + 260 + k * 260, y: box.y + box.height - 220 };
      const before = await strokeCount(page);
      const points = fastCircle(c, r, hz);
      await pen(client, points, () => 0.5, false);
      // The live stroke: the pen is still down.
      const live = await page.evaluate(edgeRadii, { c, r, from: 60, to: 300, selector: LIVE });
      await crop(client, `circle-${hz}hz-live`, {
        x: c.x - r - 12,
        y: c.y - r - 12,
        width: 2 * r + 24,
        height: 2 * r + 24,
      });
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...points[points.length - 1],
        button: 'left',
        buttons: 0,
        clickCount: 1,
        pointerType: 'pen',
      });
      await expect.poll(() => strokeCount(page), { timeout: 60_000 }).toBe(before + 1);
      // The finished stroke, from the tiles.
      let tiles: number[] = [];
      await expect
        .poll(
          async () => {
            tiles = await page.evaluate(edgeRadii, { c, r, from: 60, to: 300, selector: TILES });
            return tiles.filter((v) => Number.isNaN(v)).length;
          },
          { timeout: 30_000 },
        )
        .toBe(0);
      await crop(client, `circle-${hz}hz`, { x: c.x - r - 12, y: c.y - r - 12, width: 2 * r + 24, height: 2 * r + 24 });
      // A circle through the samples bulges between them by its sagitta when drawn as straight segments: 1.5 CSS
      // pixels (6 device pixels) at 60 Hz. Drawn as a curve, the edge stays within half a CSS pixel of round.
      const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
      expect.soft(live.filter((v) => Number.isNaN(v))).toEqual([]);
      expect.soft(spread(live), `live ${hz} Hz`).toBeLessThan(0.5);
      expect.soft(spread(tiles), `tiles ${hz} Hz`).toBeLessThan(0.5);
    }
    // Cursive loops, for the crops.
    for (const [k, perLoop] of [9, 18].entries()) {
      const at = { x: box.x + 640, y: box.y + box.height - 330 + k * 150 };
      const before = await strokeCount(page);
      await pen(client, loops(at, perLoop), () => 0.5);
      await expect.poll(() => strokeCount(page), { timeout: 60_000 }).toBe(before + 1);
      await page.waitForTimeout(500);
      await crop(client, `loops-${perLoop === 9 ? 60 : 120}hz`, { x: at.x - 40, y: at.y - 45, width: 520, height: 90 });
    }
  });
});

test.describe('shapes', () => {
  test.use({ boot: { settings: { ink: { shapes: { hold: false, inkToShape: true } } } } as never });

  test('a recognized rectangle draws every side at one width, with closed corners', async ({ page, context }) => {
    test.setTimeout(240_000);
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    const client = await context.newCDPSession(page);
    const box = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const o = { x: box.x + 200, y: box.y + box.height - 330 };
    const corners: Vec[] = [o, { x: o.x + 300, y: o.y }, { x: o.x + 300, y: o.y + 180 }, { x: o.x, y: o.y + 180 }];
    // A hand-drawn rectangle: each side in 14 samples that wobble, the pen pressing harder, then easing off.
    const path: Vec[] = [];
    for (let i = 0; i < 4; i += 1) {
      const [a, b] = [corners[i], corners[(i + 1) % 4]];
      for (let k = 0; k < 14; k += 1) {
        const t = k / 14;
        path.push({ x: a.x + (b.x - a.x) * t + (k % 3) - 1, y: a.y + (b.y - a.y) * t + ((k + 1) % 3) - 1 });
      }
    }
    path.push({ x: o.x + 4, y: o.y + 2 });
    const before = await strokeCount(page);
    await pen(client, path, (i) => 0.25 + 0.7 * Math.sin((Math.PI * i) / path.length));
    await expect.poll(() => strokeCount(page), { timeout: 60_000 }).toBe(before + 1);
    await page.waitForTimeout(800);
    await crop(client, 'rectangle', { x: o.x - 20, y: o.y - 20, width: 340, height: 220 });
    await crop(client, 'rectangle-corner', { x: o.x + 260, y: o.y - 20, width: 60, height: 60 });
    const along = (a: Vec, b: Vec) =>
      [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
    for (let i = 0; i < 4; i += 1) {
      const [a, b] = [corners[i], corners[(i + 1) % 4]];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      const widths = await page.evaluate(thickness, { at: along(a, b), n, selector: TILES });
      expect.soft(Math.min(...widths), `side ${i} ${widths.join(', ')}`).toBeGreaterThan(0.85 * Math.max(...widths));
    }
  });
});
