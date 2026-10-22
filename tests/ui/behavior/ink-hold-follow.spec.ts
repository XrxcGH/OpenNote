// Hold to shape, then move: draw a rough line (or an arrow, head and all), hold the pen still until it snaps, then move
// without lifting. The line's far end follows the pen and snaps to the grid's lines; lifting stores an exact line, or an
// exact arrow when its head was drawn, ending on the crossing the pen was taken to. The test reads the stored stroke
// from the page service and the paper's lines from the SVG the page draws.
import type { CDPSession } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  Ctx,
  VIEWPORT,
  along,
  gridTargets,
  inView,
  onCrossing,
  openPaper,
  readPaper,
  storedStrokes,
} from '../paperSnap';
import type { Vec } from '../paperSnap';

test.use({
  boot: {
    settings: { ink: { shapes: { hold: true, holdMs: 450, inkToShape: true }, gestures: { circleSelect: false } } },
  } as never,
  viewport: VIEWPORT,
});

/** A pen stroke through `drawn`, held still, then moved to `to` and lifted there. Points are in page units. */
async function holdThenMove(ctx: Ctx, client: CDPSession, drawn: Vec[], to: Vec): Promise<Vec[]> {
  const before = new Set((await ctx.page.evaluate(storedStrokes)).map((s) => s.id));
  await ctx.refresh();
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Vec, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      ...ctx.toWindow(p),
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
      force: buttons ? 0.5 : 0,
    });
  const path = along(drawn, 6);
  await send('mousePressed', path[0], 1);
  for (const p of path.slice(1)) await send('mouseMoved', p, 1);
  // Hold still: the stroke snaps to a shape.
  await ctx.page.waitForTimeout(1200);
  for (const p of along([path[path.length - 1], to], 6).slice(1)) await send('mouseMoved', p, 1);
  await send('mouseReleased', to, 0);
  await expect
    .poll(async () => (await ctx.page.evaluate(storedStrokes)).length, { timeout: 60_000 })
    .toBe(before.size + 1);
  return (await ctx.page.evaluate(storedStrokes)).find((s) => !before.has(s.id))!.points;
}

test('holding a line, then moving, takes its end to a grid crossing; a drawn head makes it an arrow', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  await openPaper(page, 'Grid, 5 mm');
  const client = await context.newCDPSession(page);
  const ctx = new Ctx(page, client);
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  const world = await ctx.refresh();
  const { drawn } = await page.evaluate(readPaper);
  const { rows, columns, step: s } = gridTargets(drawn, world, overlay, 0.3, 0.9);
  const cols = inView(world, overlay, columns, 60);
  const c0 = cols[Math.floor(cols.length / 4)];
  const off = 0.2 * s;

  // A level line, held, then its end taken down and right, a little off a crossing.
  const target = { x: c0 + 5 * s, y: rows[4] };
  const line = await holdThenMove(
    ctx,
    client,
    [
      { x: c0 + off, y: rows[1] + off },
      { x: c0 + 6 * s, y: rows[1] - off * 0.5 },
    ],
    { x: target.x + off, y: target.y - off },
  );
  expect(line).toHaveLength(2);
  expect(onCrossing(drawn, line[0]), `start ${line[0].x},${line[0].y}`).toBe(true);
  expect(line[1].x).toBeCloseTo(target.x, 1);
  expect(line[1].y).toBeCloseTo(target.y, 1);

  // An arrow drawn with its head, held, then its tip taken up to another crossing: still an arrow, tip on the crossing.
  const a = { x: c0, y: rows[7] };
  const tip = { x: c0 + 6 * s, y: rows[7] };
  const head = 1.2 * s;
  const arrowTarget = { x: c0 + 8 * s, y: rows[5] };
  const arrow = await holdThenMove(
    ctx,
    client,
    [
      { x: a.x + off, y: a.y + off * 0.5 },
      tip,
      { x: tip.x - head, y: tip.y - head * 0.6 },
      tip,
      { x: tip.x - head, y: tip.y + head * 0.6 },
    ],
    { x: arrowTarget.x - off, y: arrowTarget.y + off },
  );
  expect(arrow).toHaveLength(5);
  // An arrow is stored as start, tip, barb, tip, barb.
  expect(arrow[1].x).toBeCloseTo(arrowTarget.x, 1);
  expect(arrow[1].y).toBeCloseTo(arrowTarget.y, 1);
  expect(arrow[3]).toEqual(arrow[1]);
});
