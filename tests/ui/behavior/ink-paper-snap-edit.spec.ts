// Snapping to paper lines beyond the first stroke: zoom 50 and 200 percent, the second sheet, the first sheet's header,
// ruled paper's reach and its margin line, freehand ink, a triangle, library shapes, keyboard nudges, move and handle
// drags, Alt, the rings, and the Draw tab's switch (in More at the default window size) kept across a reload. Every
// check reads the stored stroke from the page service and the paper's lines from the SVG the page draws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../fixtures';
import {
  Ctx,
  OUT,
  VIEWPORT,
  drawControl,
  gridTargets,
  inView,
  isOn,
  lineAt,
  onCrossing,
  openPaper,
  pen,
  press,
  along,
  readPaper,
  setZoom,
  settledWorld,
  storedStrokes,
  uniq,
} from '../paperSnap';
import type { Vec } from '../paperSnap';

// Shapes come from Ink to shape when the pen lifts (see ink-paper-snap.spec.ts for why Hold to shape is off).
test.use({
  boot: {
    settings: { ink: { shapes: { hold: false, inkToShape: true }, gestures: { circleSelect: false } } },
  } as never,
  viewport: VIEWPORT,
});

const log = (name: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 1));
};

/** A rough rectangle a little off the lines, from a corner near (x, y), w by h spacings. */
const roughBox = (x: number, y: number, w: number, h: number, s: number): Vec[] => {
  const off = 0.22 * s;
  return [
    { x: x + off, y: y + off },
    { x: x + w * s - off, y: y + off * 0.8 },
    { x: x + w * s - off * 0.7, y: y + h * s + off },
    { x: x + off * 0.5, y: y + h * s + off * 0.6 },
    { x: x + off, y: y + off },
  ];
};

for (const target of [0.5, 2]) {
  test(`grid snapping at zoom ${target * 100}%`, async ({ page, context }) => {
    test.setTimeout(900_000);
    await openPaper(page, 'Grid, 5 mm');
    const ctx = new Ctx(page, await context.newCDPSession(page));
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const world = await setZoom(page, target, overlay);
    expect(Math.abs(world.zoom - target)).toBeLessThan(0.03);
    const { drawn } = await page.evaluate(readPaper);
    const { rows, columns, step: s } = gridTargets(drawn, world, overlay, 0.35, 0.85);
    const cols = inView(world, overlay, columns, 40);
    const cA = cols[Math.floor(cols.length / 3)];
    const off = 0.22 * s;
    const [line] = await ctx.draw([
      { x: cA + off, y: rows[1] + off },
      { x: cA + 4 * s - off, y: rows[1] - off * 0.5 },
    ]);
    const [rect] = await ctx.draw(roughBox(cA, rows[3], 3, 2, s));
    log(`zoom-${target}`, { zoom: world.zoom, s, line, rect: rect.slice(0, 4) });
    expect(line).toHaveLength(2);
    for (const p of line) expect(onCrossing(drawn, p), `line end ${p.x},${p.y}`).toBe(true);
    for (const p of rect.slice(0, 4)) expect(onCrossing(drawn, p), `rect corner ${p.x},${p.y}`).toBe(true);
    await ctx.shot(`zoom-${target * 100}-line-start`, line[0], 1.5 * s);
    await ctx.shot(`zoom-${target * 100}-rect-corner`, rect[0], 1.5 * s);
  });
}

test('grid snapping on the second sheet, and none in the first sheet header', async ({ page, context }) => {
  test.setTimeout(900_000);
  await openPaper(page, 'Grid, 5 mm');
  const ctx = new Ctx(page, await context.newCDPSession(page));
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  let world = await ctx.refresh();
  let { drawn } = await page.evaluate(readPaper);
  const rows0 = uniq(drawn.rows.filter((r) => r.y < drawn.sheets[0].height).map((r) => r.y));
  const s = Math.round((rows0[1] - rows0[0]) * 100) / 100;
  const cols = inView(world, overlay, uniq(drawn.columns.map((c) => c.x)), 40);
  const cA = cols[Math.floor(cols.length / 3)];
  // A level line in the header, a spacing and a half above the first line the sheet draws: nothing there to snap to.
  const hy = rows0[0] - 1.5 * s;
  expect(world.y + hy * world.zoom, 'the header is in view').toBeGreaterThan(overlay.y + 10);
  const [header] = await ctx.draw([
    { x: cA + 0.2 * s, y: hy },
    { x: cA + 3.8 * s, y: hy + 0.05 * s },
  ]);
  log('grid-header', { first: rows0[0], s, hy, header });
  for (const p of header) expect(lineAt(drawn, p).row, `header end ${p.x},${p.y} on a row`).toBe(false);
  expect(Math.abs(header[0].y - hy)).toBeLessThan(0.5);
  expect(Math.abs(header[0].x - (cA + 0.2 * s))).toBeLessThan(0.5);

  if (drawn.sheets.length < 2) {
    await page.keyboard.press('Control+KeyK');
    const box = page.getByRole('combobox', { name: 'Search commands and pages' });
    await expect(box).toBeFocused();
    await box.pressSequentially('Add a sheet', { delay: 20 });
    await expect(page.getByRole('option', { name: /Add a sheet/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('[data-ruled] svg').length), { timeout: 30_000 })
      .toBeGreaterThan(1);
    ({ drawn } = await page.evaluate(readPaper));
  }
  const sheet1 = drawn.sheets[1];
  await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
  for (let i = 0; i < 60; i += 1) {
    world = await settledWorld(page);
    if (world.y + sheet1.top * world.zoom < overlay.y + overlay.height * 0.25) break;
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
  }
  world = await ctx.refresh();
  ({ drawn } = await page.evaluate(readPaper));
  const rows1 = uniq(drawn.rows.filter((r) => r.y > sheet1.top).map((r) => r.y)).filter(
    (y) => world.y + y * world.zoom > overlay.y + 60 && world.y + y * world.zoom < overlay.y + overlay.height - 60,
  );
  const off = 0.22 * s;
  const [line] = await ctx.draw([
    { x: cA + off, y: rows1[2] + off },
    { x: cA + 4 * s - off, y: rows1[2] - off * 0.5 },
  ]);
  const [rect] = await ctx.draw(roughBox(cA, rows1[5], 3, 2, s));
  log('sheet2', { sheet1, rows1: rows1.slice(0, 4), line, rect: rect.slice(0, 4) });
  for (const p of line) expect(onCrossing(drawn, p), `sheet 2 line end ${p.x},${p.y}`).toBe(true);
  for (const p of rect.slice(0, 4)) expect(onCrossing(drawn, p), `sheet 2 rect corner ${p.x},${p.y}`).toBe(true);
  await ctx.shot('sheet2-line-start', line[0], 1.5 * s);
});

test('ruled paper: a level line takes a rule within reach only, and ends snap to the margin line', async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);
  await openPaper(page, 'Lined, college');
  const ctx = new Ctx(page, await context.newCDPSession(page));
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  let world = await ctx.refresh();
  let { drawn } = await page.evaluate(readPaper);
  const rows0 = uniq(drawn.rows.filter((r) => r.y < drawn.sheets[0].height).map((r) => r.y));
  const s = Math.round((rows0[1] - rows0[0]) * 100) / 100;
  const left = Math.min(...drawn.rows.map((r) => r.x1));
  const x0 = left + 150;
  const r = rows0.filter((y) => world.y + y * world.zoom > overlay.y + overlay.height * 0.4)[0];

  // Midway between two rules: out of reach of both, so it stays where it was drawn.
  const mid = r + 0.5 * s;
  const [between] = await ctx.draw([
    { x: x0, y: mid },
    { x: x0 + 4 * s, y: mid + 0.03 * s },
  ]);
  // In the header, a spacing and a half above the first rule: it stays in the header.
  const hy = rows0[0] - 1.5 * s;
  const [header] = await ctx.draw([
    { x: x0, y: hy },
    { x: x0 + 4 * s, y: hy + 0.03 * s },
  ]);
  // A fifth of a spacing off a rule: it lies on the rule.
  const [close] = await ctx.draw([
    { x: x0, y: r + 2 * s + 0.2 * s },
    { x: x0 + 4 * s, y: r + 2 * s + 0.24 * s },
  ]);
  log('ruled-reach', { s, first: rows0[0], r, mid, between, hy, header, close });
  expect(Math.abs(between[0].y - mid)).toBeLessThan(0.5);
  expect(Math.abs(header[0].y - hy)).toBeLessThan(0.5);
  for (const p of [...between, ...header]) expect(lineAt(drawn, p).row, `${p.x},${p.y} on a rule`).toBe(false);
  for (const p of close) expect(lineAt(drawn, p).row, `close end ${p.x},${p.y} on a rule`).toBe(true);
  expect(close[0].y).toBe(close[1].y);

  // The margin line, from View > Background: a line drawn down beside it has its ends on it, and on rules.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
  const margin = page.getByRole('menuitemcheckbox', { name: 'Margin line' });
  await expect(margin).toHaveAttribute('aria-checked', 'false');
  await margin.click();
  await page.getByRole('tab', { name: 'Draw' }).click();
  world = await ctx.refresh();
  ({ drawn } = await page.evaluate(readPaper));
  const marginX = drawn.columns.map((c) => c.x)[0];
  expect(marginX, 'the margin line is drawn').toBeDefined();
  const [down] = await ctx.draw([
    { x: marginX + 0.2 * s, y: r + 0.15 * s },
    { x: marginX + 0.15 * s, y: r + 4 * s - 0.2 * s },
  ]);
  log('ruled-margin', { marginX, down });
  for (const p of down) {
    expect(lineAt(drawn, p).column, `margin end ${p.x},${p.y}`).toBe(true);
    expect(lineAt(drawn, p).row, `margin end ${p.x},${p.y} on a rule`).toBe(true);
  }
  await ctx.shot('ruled-margin-end', down[0], 1.5 * s);
});

test.describe('library shapes', () => {
  // Wide enough for the Draw tab to show its Shapes menu.
  test.use({ viewport: { width: 2560, height: 1000 } });

  test('dot paper: freehand never snaps, a triangle and a library rectangle land on dots', async ({
    page,
    context,
  }) => {
    test.setTimeout(900_000);
    await openPaper(page, 'Dot grid');
    const ctx = new Ctx(page, await context.newCDPSession(page));
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const world = await ctx.refresh();
    const { drawn } = await page.evaluate(readPaper);
    const ys = uniq(drawn.dots.map((d) => d.y)).filter(
      (y) =>
        world.y + y * world.zoom > overlay.y + overlay.height * 0.35 &&
        world.y + y * world.zoom < overlay.y + overlay.height - 60,
    );
    const xs = inView(world, overlay, uniq(drawn.dots.map((d) => d.x)), 60);
    const s = Math.round((ys[1] - ys[0]) * 100) / 100;
    const wave = Array.from({ length: 30 }, (_, i) => ({
      x: xs[2] + 0.2 * s + i * 0.5 * s,
      y: ys[1] + 0.2 * s + Math.sin(i / 2) * 0.6 * s,
    }));
    const [free] = await ctx.draw(wave);
    expect(free.length).toBeGreaterThan(8);
    expect(Math.abs(free[0].x - wave[0].x)).toBeLessThan(0.6);
    expect(Math.abs(free[0].y - wave[0].y)).toBeLessThan(0.6);
    const off = 0.22 * s;
    const t0 = { x: xs[8] + off, y: ys[2] + 4 * s - off };
    const [tri] = await ctx.draw([
      t0,
      { x: xs[8] + 4 * s - off, y: ys[2] + 4 * s + off * 0.5 },
      { x: xs[8] + 2 * s + off * 0.6, y: ys[2] + off },
      t0,
    ]);
    log('dots-triangle', { tri });
    expect(tri).toHaveLength(4);
    for (const p of tri.slice(0, 3)) expect(lineAt(drawn, p).dot, `triangle corner ${p.x},${p.y}`).toBe(true);
    await ctx.shot('dots-triangle-corner', tri[0], 1.5 * s);

    await onPage(ctx, overlay);
    const lib = await addFromLibrary(page, 'Rectangle');
    log('dots-library', { lib });
    expect(lineAt(drawn, { x: lib.minX, y: lib.minY }).dot).toBe(true);
    expect(lineAt(drawn, { x: lib.maxX, y: lib.maxY }).dot).toBe(true);
    await ctx.shot('dots-library-corner', { x: lib.minX, y: lib.minY }, 1.5 * s);
  });

  test('grid paper: a library pentagon takes whole spacings on the lines', async ({ page, context }) => {
    test.setTimeout(900_000);
    await openPaper(page, 'Grid, 5 mm');
    const ctx = new Ctx(page, await context.newCDPSession(page));
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    await ctx.refresh();
    await onPage(ctx, overlay);
    const lib = await addFromLibrary(page, 'Pentagon');
    const { drawn } = await page.evaluate(readPaper);
    log('grid-pentagon', { lib });
    expect(onCrossing(drawn, { x: lib.minX, y: lib.minY })).toBe(true);
    expect(onCrossing(drawn, { x: lib.maxX, y: lib.maxY })).toBe(true);
    await ctx.shot('grid-pentagon-corner', { x: lib.minX, y: lib.minY }, 30);
  });
});

/**
 * Zooms the page to 250 percent about the middle of its sheet, so the middle of the view, where a library shape goes,
 * is on the sheet: a window this wide shows more than the sheet's width.
 */
async function onPage(ctx: Ctx, overlay: { x: number; y: number; width: number; height: number }) {
  const world = await ctx.refresh();
  const at = ctx.toWindow({ x: 408, y: (overlay.y + overlay.height / 2 - world.y) / world.zoom });
  await setZoom(ctx.page, 2.5, overlay, at);
  await ctx.refresh();
}

/** Adds a shape from Shapes > Basic shapes and returns the box around its stored points. */
async function addFromLibrary(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Basic shapes' }).hover();
  const before = (await page.evaluate(storedStrokes)).length;
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(storedStrokes)).length).toBeGreaterThan(before);
  const points = (await page.evaluate(storedStrokes)).slice(before).flatMap((stroke) => stroke.points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

test('grid: keyboard nudges, move and handle drags, Alt, and the rings', async ({ page, context }) => {
  test.setTimeout(900_000);
  await openPaper(page, 'Grid, 5 mm');
  const client = await context.newCDPSession(page);
  const ctx = new Ctx(page, client);
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  const world = await ctx.refresh();
  const { drawn } = await page.evaluate(readPaper);
  const { rows, columns, step: s } = gridTargets(drawn, world, overlay, 0.35, 0.85);
  const cols = inView(world, overlay, columns);
  const cA = cols[Math.floor(cols.length / 3)];
  const r1 = rows[2];
  const off = 0.22 * s;
  const [line] = await ctx.draw([
    { x: cA + off, y: r1 + off },
    { x: cA + 5 * s - off, y: r1 - off * 0.5 },
  ]);
  expect(line).toHaveLength(2);
  for (const p of line) expect(onCrossing(drawn, p)).toBe(true);
  const points = async () => (await page.evaluate(storedStrokes)).at(-1)!.points;

  // Select it with the lasso; the frame's move button takes the keyboard.
  await (await drawControl(page, 'Lasso select')).click();
  const c = { x: cA + 2.5 * s, y: r1 };
  const loop = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return ctx.toWindow({ x: c.x + 3.5 * s * Math.cos(a), y: c.y + 1.2 * s * Math.sin(a) });
  });
  await pen(client, loop);
  const mover = page.getByRole('button', { name: 'Move the selection' });
  await expect(mover).toBeVisible();
  await mover.focus();
  await expect(mover).toBeFocused();

  // Arrow keys move the shape one spacing, onto the next lines.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await points())[0].x).toBeCloseTo(line[0].x + s, 1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await points())[0].y).toBeCloseTo(line[0].y + s, 1);
  const nudged = await points();
  log('nudge', { s, line, nudged });
  for (const p of nudged) expect(onCrossing(drawn, p)).toBe(true);

  // A move drag of 0.3 spacings lands back on the crossings, with rings while it goes.
  let box = (await mover.boundingBox())!;
  let from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const d = 0.3 * s * world.zoom;
  let rings = 0;
  await pen(client, along([from, { x: from.x + d, y: from.y + d }], 4), false, async () => {
    rings = await page.locator('[data-ink-snap-marks] > div').count();
  });
  await expect.poll(async () => (await points())[0].x).toBeCloseTo(nudged[0].x, 1);
  const back = await points();
  log('move-drag', { nudged, back, rings });
  for (const p of back) expect(onCrossing(drawn, p)).toBe(true);
  expect(rings).toBeGreaterThan(0);
  expect(await page.locator('[data-ink-snap-marks]').getAttribute('aria-hidden')).toBe('true');
  await expect.poll(async () => page.locator('[data-ink-snap-marks] > div').count(), { timeout: 5000 }).toBe(0);

  // A move of 0.8 spacings lands one spacing over.
  box = (await mover.boundingBox())!;
  from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await pen(client, along([from, { x: from.x + (0.8 / 0.3) * d, y: from.y }], 4));
  await expect.poll(async () => (await points())[0].x).toBeCloseTo(back[0].x + s, 1);
  const over = await points();

  // With Alt held the drag stays where it was dragged.
  box = (await mover.boundingBox())!;
  from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await pen(client, along([from, { x: from.x + d, y: from.y + d }], 4), true);
  await expect.poll(async () => (await points())[0].x).toBeCloseTo(over[0].x + 0.3 * s, 0);
  const free = await points();
  log('alt-drag', { over, free });
  expect(free[0].y).toBeCloseTo(over[0].y + 0.3 * s, 0);
  expect(onCrossing(drawn, free[0])).toBe(false);

  // The end handle, where the moves left the end, dragged near a crossing, lands on it.
  // Focusing the selection can scroll the page: read where it is now.
  await ctx.refresh();
  const handles = page.locator('[data-ink-shape-handle]');
  expect(await handles.count()).toBeGreaterThan(0);
  const hb = (await handles.last().boundingBox())!;
  // Aim a little off the crossing two spacings right of and one below where the end was before the Alt drag.
  const crossing = { x: over[1].x + 2 * s, y: over[1].y + s };
  const aim = { x: crossing.x + 0.2 * s, y: crossing.y - 0.15 * s };
  await pen(client, along([{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, ctx.toWindow(aim)], 6));
  await expect.poll(async () => onCrossing(drawn, (await points())[1])).toBe(true);
  const reshaped = await points();
  log('handle-drag', { aim, reshaped });
  // The other end stays where the moves left it.
  expect(reshaped[0].x).toBeCloseTo(free[0].x, 1);
  expect(reshaped[0].y).toBeCloseTo(free[0].y, 1);
  expect(reshaped[1].x).toBeCloseTo(crossing.x, 1);
  expect(reshaped[1].y).toBeCloseTo(crossing.y, 1);
  await ctx.shot('handle-drag-end', reshaped[1], 1.5 * s);
});

test.describe('the Draw tab switch', () => {
  // The default window: the snap group is in More.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Snap to paper lines is reachable, kept across a reload, and plain paper keeps Snap to grid', async ({
    page,
    context,
  }) => {
    test.setTimeout(900_000);
    // The pens are in More at this size too; the pen is the tool a page opens with.
    await openPaper(page, 'Grid, 5 mm', { pen: false });
    expect(await isOn(page, 'Snap to paper lines')).toBe(true);
    await (await drawControl(page, 'Snap to paper lines')).click();
    expect(await isOn(page, 'Snap to paper lines')).toBe(false);
    // Load the app again. The web preview's pages live in memory, so the paper is set again; the switch is kept.
    await openPaper(page, 'Grid, 5 mm', { pen: false });
    expect(await isOn(page, 'Snap to paper lines')).toBe(false);

    // Off, a line drawn off the lines stays off them. The pens fit in a wider window.
    await page.setViewportSize(VIEWPORT);
    await press(page, 'Pen, Ink, 0.5 mm', true);
    const ctx = new Ctx(page, await context.newCDPSession(page));
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    const world = await ctx.refresh();
    const { drawn } = await page.evaluate(readPaper);
    const { rows, columns, step: s } = gridTargets(drawn, world, overlay, 0.35, 0.85);
    const cA = inView(world, overlay, columns)[3];
    const [line] = await ctx.draw([
      { x: cA + 0.25 * s, y: rows[1] + 0.25 * s },
      { x: cA + 4 * s, y: rows[1] + 0.25 * s },
    ]);
    expect(onCrossing(drawn, line[0])).toBe(false);
    await (await drawControl(page, 'Snap to paper lines')).click();
    expect(await isOn(page, 'Snap to paper lines')).toBe(true);

    // Plain paper: the switch is Snap to grid, and Snap to paper lines is not offered.
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
    await page.getByRole('menuitemradio', { name: 'Plain', exact: true }).click();
    await page.getByRole('tab', { name: 'Draw' }).click();
    expect(await isOn(page, 'Snap to grid')).toBe(false);
    const bar = page.getByRole('toolbar', { name: 'Draw' });
    if (!(await bar.getByRole('button', { name: 'Snap to paper lines' }).isVisible())) {
      await bar.getByRole('button', { name: 'More commands', exact: true }).click();
      await expect(page.getByRole('menuitemcheckbox', { name: 'Snap to grid' })).toBeVisible();
      await expect(page.getByRole('menuitemcheckbox', { name: 'Snap to paper lines' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });
});
