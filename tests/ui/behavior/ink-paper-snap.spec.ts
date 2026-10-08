// Lines, arrows, rectangles, and ellipses snap to the lines of ruled, grid, and dot paper. The test draws each with pen
// input sent through the DevTools Protocol, a little off the paper's lines, with Ink to shape on, then reads the stored
// stroke from the web platform's page service and checks that every point that snapped lies on a line (or a dot) the
// paper draws, within 0.01 page units. The paper's lines are read from the paper the page shows (its SVG path data),
// never from the page's own numbers. A pixel check at 4x then finds the drawn line's ink and the paper's line in a
// screenshot and checks that the one is centered on the other, and 4x crops of every case are saved, light and dark.
// Holding Alt while drawing keeps a shape where it was drawn.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const CROPS = process.env.OPENNOTE_PAPER_SNAP_CROPS ?? join(import.meta.dirname, '..', 'results', 'paper-snap-crops');
const TOLERANCE = 0.01;
const SCALE = 4;
/** Wide enough for the Draw tab to show its pens. */
const VIEWPORT = { width: 1920, height: 1000 };

const PAPERS = [
  { menu: 'Lined, college', kind: 'ruled' },
  { menu: 'Grid, 5 mm', kind: 'grid' },
  { menu: 'Dot grid', kind: 'dots' },
] as const;
type Kind = (typeof PAPERS)[number]['kind'];

// Shapes come from Ink to shape when the pen lifts. Hold to shape is off: the pen events come through the DevTools
// Protocol one at a time, and a busy moment between two of them would read as the pen held still, making a shape of
// half a stroke. The circle-select gesture is off so an ellipse stays a drawing.
test.use({
  boot: {
    settings: { ink: { shapes: { hold: false, inkToShape: true }, gestures: { circleSelect: false } } },
  } as never,
});

interface Vec {
  x: number;
  y: number;
}

/** The paper the page shows, in page units: its horizontal and vertical lines and its dots. */
interface Drawn {
  rows: { y: number; x1: number; x2: number }[];
  columns: { x: number; y1: number; y2: number }[];
  dots: Vec[];
}

/** Where the page's world is in the window, and its zoom. */
interface World {
  x: number;
  y: number;
  zoom: number;
}

async function openPaper(page: Page, paper: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await page.getByRole('tab', { name: 'View' }).click();
  const bar = page.getByRole('toolbar');
  const mode = bar.getByRole('button', { name: 'Pages with breaks', exact: true });
  if ((await mode.getAttribute('aria-pressed')) !== 'true') await mode.click();
  await bar.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('menuitemradio', { name: paper, exact: true }).click();
  await expect(page.locator('[data-ruled]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await expect(page.locator('[data-ink-overlay]')).toHaveCount(1);
  // Snap to paper lines is on by default for lined paper (DrawSnap.test.tsx checks the switch); nothing turns it on.
  await press(page, 'Ink to shape', true);
  await press(page, 'Pen, Ink, 0.5 mm', true);
}

/** A control of the Draw tab, in the bar or, when the bar is too narrow for it, under More. */
async function drawControl(page: Page, name: string) {
  const bar = page.getByRole('toolbar', { name: 'Draw' });
  const button = bar.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) return button.first();
  await bar.getByRole('button', { name: 'More commands', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'More commands' });
  const item = menu
    .getByRole('menuitemcheckbox', { name, exact: true })
    .or(menu.getByRole('menuitem', { name, exact: true }));
  await expect(item).toBeVisible();
  return item;
}

/** Turns a Draw tab switch on, or chooses a tool, wherever the bar shows it. */
async function press(page: Page, name: string, on: boolean): Promise<void> {
  const control = await drawControl(page, name);
  const state = (await control.getAttribute('aria-pressed')) ?? (await control.getAttribute('aria-checked'));
  if ((state === 'true') !== on) await control.click();
  else if ((await control.getAttribute('role'))?.startsWith('menuitem')) await page.keyboard.press('Escape');
}

/** Waits until the page stops moving (the view settles its zoom and scroll after the paper changes), and reads it. */
async function settledPaper(page: Page): Promise<ReturnType<typeof readPaper>> {
  await settledWorld(page);
  return page.evaluate(readPaper);
}

/** Where the page's world is once it stops moving: two readings a quarter second apart agree. */
async function settledWorld(page: Page): Promise<World> {
  let last = '';
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-ruled]')!;
      const rect = world.getBoundingClientRect();
      return { x: rect.x, y: rect.y, zoom: rect.width / world.offsetWidth };
    });
    const key = `${now.x}:${now.y}:${now.zoom}`;
    if (key === last) return now;
    last = key;
    await page.waitForTimeout(250);
  }
  throw new Error('The page never settled');
}

/** The paper's lines and dots from the SVG the page draws, moved to where each piece of paper sits in the world. */
function readPaper(): { drawn: Drawn; world: World } {
  const world = document.querySelector<HTMLElement>('[data-ruled]')!;
  const rect = world.getBoundingClientRect();
  const zoom = rect.width / world.offsetWidth;
  const drawn: Drawn = { rows: [], columns: [], dots: [] };
  for (const svg of world.querySelectorAll('svg')) {
    const box = svg.getBoundingClientRect();
    const dx = (box.x - rect.x) / zoom;
    const dy = (box.y - rect.y) / zoom;
    for (const path of svg.querySelectorAll('path')) {
      const d = path.getAttribute('d') ?? '';
      for (const m of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)) {
        const [x1, y1, x2, y2] = [+m[1] + dx, +m[2] + dy, +m[3] + dx, +m[4] + dy];
        if (Math.abs(y1 - y2) < 1e-6) drawn.rows.push({ y: y1, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
        else if (Math.abs(x1 - x2) < 1e-6) drawn.columns.push({ x: x1, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
      }
      for (const m of d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h0/g)) drawn.dots.push({ x: +m[1] + dx, y: +m[2] + dy });
    }
  }
  return { drawn, world: { x: rect.x, y: rect.y, zoom } };
}

/** The page's strokes as the page service holds them, decoded to page units, in the order they were drawn. */
function storedStrokes(): { id: string; points: Vec[] }[] {
  const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
  const held = hooks.pagesHeld() as {
    memoryInk?: Record<string, { start: number; id: string; channels: number; pointCount: number; points: Uint8Array }>;
  };
  const strokes = Object.values(held.memoryInk ?? {}).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return strokes.map((stroke) => {
    const bytes = stroke.points;
    let pos = 0;
    const varint = () => {
      let value = 0;
      let scale = 1;
      for (;;) {
        const byte = bytes[pos++];
        value += (byte & 0x7f) * scale;
        if ((byte & 0x80) === 0) return value;
        scale *= 128;
      }
    };
    const zigzag = () => {
      const v = varint();
      return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
    };
    const extra = (stroke.channels & 1 ? 1 : 0) + (stroke.channels & 2 ? 2 : 0) + (stroke.channels & 4 ? 1 : 0);
    const out: Vec[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < stroke.pointCount; i += 1) {
      x += zigzag();
      y += zigzag();
      for (let k = 0; k < extra; k += 1) varint();
      out.push({ x: x / 64, y: y / 64 });
    }
    return { id: stroke.id, points: out };
  });
}

/** A pen stroke through window points, sent as pen input. `alt` holds Alt down the whole time. */
async function pen(client: CDPSession, points: readonly Vec[], alt = false): Promise<void> {
  const modifiers = alt ? 1 : 0;
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Vec, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      buttons,
      clickCount: 1,
      modifiers,
      pointerType: 'pen',
      force: buttons ? 0.5 : 0,
    });
  await send('mousePressed', points[0], 1);
  for (const p of points.slice(1)) await send('mouseMoved', p, 1);
  await send('mouseReleased', points[points.length - 1], 0);
}

/** Points every few page units along a path through corners. */
function along(corners: readonly Vec[], every = 10): Vec[] {
  const out: Vec[] = [corners[0]];
  for (let i = 1; i < corners.length; i += 1) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / every));
    for (let k = 1; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

function ellipsePath(c: Vec, rx: number, ry: number): Vec[] {
  return Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
  });
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** What line or dot of the drawn paper a point lies on: a row, a column, both, or a dot. */
function lineAt(drawn: Drawn, p: Vec): { row: boolean; column: boolean; dot: boolean } {
  return {
    row: drawn.rows.some((r) => near(r.y, p.y) && p.x >= r.x1 - TOLERANCE && p.x <= r.x2 + TOLERANCE),
    column: drawn.columns.some((c) => near(c.x, p.x) && p.y >= c.y1 - TOLERANCE && p.y <= c.y2 + TOLERANCE),
    dot: drawn.dots.some((d) => near(d.x, p.x) && near(d.y, p.y)),
  };
}

/** Checks that a point that snapped lies on the paper: on a crossing of grid paper, a dot, or a rule. */
function expectOnPaper(kind: Kind, drawn: Drawn, p: Vec, what: string): void {
  const on = lineAt(drawn, p);
  if (kind === 'grid') expect(on.row && on.column, `${what} (${p.x}, ${p.y}) on a grid crossing`).toBe(true);
  else if (kind === 'dots') expect(on.dot, `${what} (${p.x}, ${p.y}) on a dot`).toBe(true);
  else expect(on.row, `${what} (${p.x}, ${p.y}) on a rule`).toBe(true);
}

function bounds(points: readonly Vec[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The lattice's lines near the middle of the view: rows and columns to draw on, in page units. */
function targets(kind: Kind, drawn: Drawn, view: { top: number; left: number; height: number }) {
  const unique = (values: number[]) => [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  const rowsAll = unique(kind === 'dots' ? drawn.dots.map((d) => d.y) : drawn.rows.map((r) => r.y));
  const rows = rowsAll.filter((y) => y > view.top + view.height * 0.3 && y < view.top + view.height - 40);
  const step = rows[1] - rows[0];
  let columns = unique(kind === 'dots' ? drawn.dots.map((d) => d.x) : drawn.columns.map((c) => c.x));
  if (kind === 'ruled') {
    const left = Math.min(...drawn.rows.map((r) => r.x1));
    columns = Array.from({ length: 30 }, (_, i) => left + 96 + i * step);
  }
  return { rows, columns, step };
}

/** A screenshot crop at 4x, saved, and its pixels read in a second page: the contrast of each pixel to the paper. */
async function crop(
  client: CDPSession,
  lab: Page,
  clip: { x: number; y: number; width: number; height: number },
  name: string,
) {
  const png = await shot(client, clip);
  mkdirSync(CROPS, { recursive: true });
  writeFileSync(join(CROPS, `${name}.png`), png);
  return lab.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const { width: W, height: H } = bitmap;
    const canvas = new OffscreenCanvas(W, H);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    const px = context.getImageData(0, 0, W, H).data;
    const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // The paper: the commonest light level in the crop.
    const counts = new Map<number, number>();
    for (let i = 0; i < px.length; i += 4) counts.set(Math.round(lum(i)), (counts.get(Math.round(lum(i))) ?? 0) + 1);
    const paper = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const contrast: number[][] = [];
    for (let y = 0; y < H; y += 1) {
      const row: number[] = [];
      for (let x = 0; x < W; x += 1) row.push(Math.abs(lum((y * W + x) * 4) - paper));
      contrast.push(row);
    }
    return { W, H, contrast };
  }, png.toString('base64'));
}

/**
 * A screenshot of part of the window at 4 device pixels to a CSS pixel. The page is drawn at 1x while the pen draws
 * (every frame at 4x makes each pen event slow), and the window turns to 4x only for the pictures.
 */
async function shot(
  client: CDPSession,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Buffer> {
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
  return Buffer.from(data, 'base64');
}

async function atScale(client: CDPSession, viewport: { width: number; height: number }, scale: number): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: scale, mobile: false });
}

/** The middle of the marks in a band of a crop, weighted by contrast: rows when `axis` is 'y', columns for 'x'. */
function centroid(contrast: number[][], axis: 'x' | 'y', band: [number, number], min = 0): number | null {
  let total = 0;
  let sum = 0;
  for (let y = 0; y < contrast.length; y += 1) {
    for (let x = 0; x < contrast[0].length; x += 1) {
      const inBand = axis === 'y' ? x >= band[0] && x < band[1] : y >= band[0] && y < band[1];
      const c = contrast[y][x];
      if (!inBand || c <= min) continue;
      total += c;
      sum += c * (axis === 'y' ? y : x);
    }
  }
  return total > 0 ? sum / total : null;
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`snapping to paper lines, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: VIEWPORT });

    for (const paper of PAPERS) {
      test(`a line, an arrow, a rectangle, and an ellipse snap to ${paper.menu}`, async ({ page, context }) => {
        // Each pen event is a round trip to the browser, so a busy machine makes this slow.
        test.setTimeout(600_000);
        await openPaper(page, paper.menu);
        if (process.env.PAPER_SNAP_DEBUG) console.log('opened');
        const client = await context.newCDPSession(page);
        const lab = await context.newPage();
        const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
        const read = await settledPaper(page);
        const { drawn } = read;
        let world = read.world;
        const toPage = (x: number, y: number) => ({ x: (x - world.x) / world.zoom, y: (y - world.y) / world.zoom });
        const toWindow = (p: Vec) => ({ x: world.x + p.x * world.zoom, y: world.y + p.y * world.zoom });
        const top = toPage(0, overlay.y).y;
        const {
          rows,
          columns,
          step: s,
        } = targets(paper.kind, drawn, {
          top,
          left: toPage(overlay.x, 0).x,
          height: overlay.height / world.zoom,
        });
        expect(rows.length, 'rows in view').toBeGreaterThan(9);
        const [r1, , r2, , r3] = rows;
        const cA = columns[2];
        const cB = columns[10];
        const off = 0.22 * s;
        const draw = async (points: Vec[], alt = false) => {
          const before = new Set((await page.evaluate(storedStrokes)).map((stroke) => stroke.id));
          // Adding ink can move the view a little (the page grows): read where the page is now.
          world = await settledWorld(page);
          await pen(client, along(points).map(toWindow), alt);
          // The first level line loads the code that checks whether it strikes through typed text, which can take a
          // while on a busy machine; the stroke is stored once that check is done.
          await expect
            .poll(async () => (await page.evaluate(storedStrokes)).length, { timeout: 180_000 })
            .toBe(before.size + 1)
            .catch(async (error: unknown) => {
              if (process.env.PAPER_SNAP_DEBUG)
                await page.screenshot({ path: join(CROPS, 'debug-stuck.png'), scale: 'css' });
              throw error;
            });
          const strokes = await page.evaluate(storedStrokes);
          if (process.env.PAPER_SNAP_DEBUG) console.log(JSON.stringify(strokes.map((x) => x.points.slice(0, 3))));
          return strokes.find((stroke) => !before.has(stroke.id))!.points;
        };

        // A line drawn a little below and right of one crossing to a little above and left of another, level.
        const line = await draw([
          { x: cA + off, y: r1 + off },
          { x: cA + 6 * s - off, y: r1 - off * 0.5 },
        ]);
        expect(line).toHaveLength(2);
        line.forEach((p, i) => expectOnPaper(paper.kind, drawn, p, `line end ${i}`));

        // An arrow: the shaft, then the head, tip to one barb, back to the tip, and to the other barb.
        const tip = { x: cA + 6 * s + off * 0.6, y: r2 - off * 0.7 };
        const barb = (sign: number) => ({
          x: tip.x - 1.6 * s * Math.cos(0.5),
          y: tip.y + sign * 1.6 * s * Math.sin(0.5),
        });
        const arrow = await draw([{ x: cA - off * 0.6, y: r2 + off * 0.8 }, tip, barb(1), tip, barb(-1)]);
        if (process.env.PAPER_SNAP_DEBUG) {
          console.log(JSON.stringify({ cA, r2, s, tip, arrow: arrow.slice(0, 6), columns: columns.slice(0, 6) }));
          await page.screenshot({ path: join(CROPS, `debug-${paper.kind}-${scheme}.png`), scale: 'css' });
        }
        expect(arrow).toHaveLength(5);
        expectOnPaper(paper.kind, drawn, arrow[0], 'arrow tail');
        expectOnPaper(paper.kind, drawn, arrow[1], 'arrow tip');

        // A rectangle, a little rough, its corners near crossings.
        const rect = await draw([
          { x: cA + off, y: r3 + off },
          { x: cA + 5 * s - off, y: r3 + off * 0.8 },
          { x: cA + 5 * s - off * 0.7, y: r3 + 3 * s + off },
          { x: cA + off * 0.5, y: r3 + 3 * s + off * 0.6 },
          { x: cA + off, y: r3 + off },
        ]);
        expect(rect).toHaveLength(5);
        rect.slice(0, 4).forEach((p, i) => expectOnPaper(paper.kind, drawn, p, `rectangle corner ${i}`));

        // An ellipse whose box is near lines: its sides touch them.
        const ellipse = await draw(
          ellipsePath({ x: cB + 3 * s + off * 0.4, y: r3 + 2 * s + off * 0.3 }, 3 * s - off * 0.5, 2 * s + off * 0.5),
        );
        const box = bounds(ellipse);
        if (process.env.PAPER_SNAP_DEBUG)
          console.log(JSON.stringify({ cB, r3, s, box, n: ellipse.length, e: ellipse.slice(0, 3) }));
        if (paper.kind === 'dots') {
          expectOnPaper('dots', drawn, { x: box.minX, y: box.minY }, 'ellipse box corner');
          expectOnPaper('dots', drawn, { x: box.maxX, y: box.maxY }, 'ellipse box corner');
        } else {
          for (const y of [box.minY, box.maxY])
            expect(lineAt(drawn, { x: (box.minX + box.maxX) / 2, y }).row).toBe(true);
          if (paper.kind === 'grid') {
            for (const x of [box.minX, box.maxX])
              expect(lineAt(drawn, { x, y: (box.minY + box.maxY) / 2 }).column).toBe(true);
          }
        }

        // Pixels at 4x: the line's ink is centered on the paper's line it lies on, and its end on the crossing.
        await atScale(client, VIEWPORT, SCALE);
        world = await settledWorld(page);
        const z = world.zoom;
        const lineY = line[0].y;
        const startX = line[0].x;
        const half = (s * z) / 2;
        // Down a column through the middle of the line (between two grid columns), and down one left of it where the
        // paper's line shows: on grid and dot paper half a step left of the line's start, a dot a whole step left.
        const middle = toWindow({ x: startX + 3.5 * s, y: lineY });
        const inkCrop = await crop(
          client,
          lab,
          { x: middle.x - 2, y: middle.y - half, width: 4, height: 2 * half },
          `${paper.kind}-${scheme}-line-middle`,
        );
        const inkRow = centroid(inkCrop.contrast, 'y', [0, inkCrop.W], 60)!;
        const paperAt = toWindow({ x: startX - (paper.kind === 'dots' ? s : 0.5 * s), y: lineY });
        const paperCrop = await crop(
          client,
          lab,
          { x: paperAt.x - 2, y: paperAt.y - half, width: 4, height: 2 * half },
          `${paper.kind}-${scheme}-paper-row`,
        );
        const paperRow = centroid(paperCrop.contrast, 'y', [0, paperCrop.W], 4)!;
        expect(inkRow, 'the ink is drawn').not.toBeNull();
        expect(paperRow, 'the paper line is drawn').not.toBeNull();
        expect(Math.abs(inkRow - paperRow), 'the line sits on the paper line, in device pixels').toBeLessThanOrEqual(
          1.5,
        );
        if (paper.kind !== 'ruled') {
          // The end of the line: its ink's left edge plus half its thickness is the crossing's column.
          const start = toWindow({ x: startX, y: lineY });
          const endCrop = await crop(
            client,
            lab,
            { x: start.x - half, y: start.y - half, width: 2 * half, height: 2 * half },
            `${paper.kind}-${scheme}-line-end`,
          );
          const mid = Math.round(endCrop.H / 2);
          const inkRowValues = endCrop.contrast[mid];
          const strong = Math.max(...inkRowValues) * 0.5;
          const left = inkRowValues.findIndex((c) => c >= strong);
          let thick = 0;
          const column = Math.min(endCrop.W - 1, left + Math.round(SCALE * 2 * z));
          for (let y = 0; y < endCrop.H; y += 1) if (endCrop.contrast[y][column] >= strong) thick += 1;
          const inkEnd = left + thick / 2;
          // The paper's column above the line: half a step up on grid paper, the dot a step up on dot paper.
          const above = toWindow({ x: startX, y: lineY - (paper.kind === 'dots' ? s : 0.5 * s) });
          const colCrop = await crop(
            client,
            lab,
            { x: start.x - half, y: above.y - 2, width: 2 * half, height: 4 },
            `${paper.kind}-${scheme}-paper-column`,
          );
          const paperColumn = centroid(colCrop.contrast, 'x', [0, colCrop.H], 4)!;
          expect(Math.abs(inkEnd - paperColumn), 'the line ends on the crossing, in device pixels').toBeLessThanOrEqual(
            2,
          );
        }

        // Crops of every case for review: the line's start, the arrow's tip, a rectangle corner, the ellipse's top.
        const shots: [string, Vec][] = [
          ['line', line[0]],
          ['arrow', arrow[1]],
          ['rectangle', rect[0]],
          ['ellipse', { x: (box.minX + box.maxX) / 2, y: box.minY }],
        ];
        for (const [name, p] of shots) {
          const at = toWindow(p);
          const png = await shot(client, {
            x: at.x - 1.5 * s * z,
            y: at.y - 1.5 * s * z,
            width: 3 * s * z,
            height: 3 * s * z,
          });
          writeFileSync(join(CROPS, `${paper.kind}-${scheme}-${name}.png`), png);
        }
        await lab.close();
      });
    }
  });
}

test('holding Alt while drawing keeps a line where it was drawn', async ({ page, context }) => {
  test.setTimeout(600_000);
  await page.setViewportSize(VIEWPORT);
  await openPaper(page, 'Grid, 5 mm');
  const client = await context.newCDPSession(page);
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  const { drawn, world } = await settledPaper(page);
  const toWindow = (p: Vec) => ({ x: world.x + p.x * world.zoom, y: world.y + p.y * world.zoom });
  const {
    rows,
    columns,
    step: s,
  } = targets('grid', drawn, {
    top: (overlay.y - world.y) / world.zoom,
    left: (overlay.x - world.x) / world.zoom,
    height: overlay.height / world.zoom,
  });
  const from = { x: columns[3] + 0.25 * s, y: rows[2] + 0.25 * s };
  const to = { x: columns[12] - 0.25 * s, y: rows[2] + 0.25 * s };
  await pen(client, along([from, to]).map(toWindow), true);
  await expect.poll(async () => (await page.evaluate(storedStrokes)).length, { timeout: 180_000 }).toBe(1);
  const [{ points: line }] = await page.evaluate(storedStrokes);
  expect(lineAt(drawn, line[0]).row).toBe(false);
  expect(Math.abs(line[0].y - from.y)).toBeLessThan(1);
});
