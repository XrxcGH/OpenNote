// Helpers for the paper-snap UI tests: open a page on a paper, read the lines the paper draws (from its SVG path
// data, never from the page's own numbers), read the strokes the page service stores, and draw with pen input sent
// through the DevTools Protocol.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from '@playwright/test';
import { expect } from './fixtures';

export const OUT = process.env.OPENNOTE_PAPER_SNAP_CROPS ?? join(import.meta.dirname, 'results', 'paper-snap-crops');
const TOL = 0.01;
export const VIEWPORT = { width: 1920, height: 1000 };

export interface Vec {
  x: number;
  y: number;
}
export interface Drawn {
  rows: { y: number; x1: number; x2: number }[];
  columns: { x: number; y1: number; y2: number }[];
  dots: Vec[];
  sheets: { top: number; height: number }[];
}
export interface World {
  x: number;
  y: number;
  zoom: number;
}

export async function openPaper(page: Page, paper: string, { pen = true } = {}): Promise<void> {
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
  await press(page, 'Ink to shape', true);
  if (pen) await press(page, 'Pen, Ink, 0.5 mm', true);
}

export async function drawControl(page: Page, name: string) {
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

export async function press(page: Page, name: string, on: boolean): Promise<void> {
  const control = await drawControl(page, name);
  const state = (await control.getAttribute('aria-pressed')) ?? (await control.getAttribute('aria-checked'));
  if ((state === 'true') !== on) await control.click();
  else if ((await control.getAttribute('role'))?.startsWith('menuitem')) await page.keyboard.press('Escape');
}

export async function settledWorld(page: Page): Promise<World> {
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

export function readPaper(): { drawn: Drawn; world: World } {
  const world = document.querySelector<HTMLElement>('[data-ruled]')!;
  const rect = world.getBoundingClientRect();
  const zoom = rect.width / world.offsetWidth;
  const drawn: Drawn = { rows: [], columns: [], dots: [], sheets: [] };
  for (const svg of world.querySelectorAll('svg')) {
    const box = svg.getBoundingClientRect();
    const dx = (box.x - rect.x) / zoom;
    const dy = (box.y - rect.y) / zoom;
    drawn.sheets.push({ top: dy, height: box.height / zoom });
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

export function storedStrokes(): { id: string; points: Vec[] }[] {
  const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
  const held = hooks.pagesHeld() as {
    memoryInk?: Record<
      string,
      {
        start: number;
        id: string;
        channels: number;
        pointCount: number;
        points: Uint8Array;
        transform?: number[] | null;
      }
    >;
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
      // A moved or reshaped stroke keeps its points and gains a transform, applied to them.
      const [a, b, c, d, e, f] = stroke.transform ?? [1, 0, 0, 1, 0, 0];
      const px = x / 64;
      const py = y / 64;
      out.push({ x: a * px + c * py + e, y: b * px + d * py + f });
    }
    return { id: stroke.id, points: out };
  });
}

export async function pen(client: CDPSession, points: readonly Vec[], alt = false, hold?: () => Promise<void>) {
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
  if (hold) await hold();
  await send('mouseReleased', points[points.length - 1], 0);
}

export function along(corners: readonly Vec[], every = 10): Vec[] {
  const out: Vec[] = [corners[0]];
  for (let i = 1; i < corners.length; i += 1) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / every));
    for (let k = 1; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

export const near = (a: number, b: number) => Math.abs(a - b) <= TOL;
export function lineAt(drawn: Drawn, p: Vec) {
  return {
    row: drawn.rows.some((r) => near(r.y, p.y) && p.x >= r.x1 - TOL && p.x <= r.x2 + TOL),
    column: drawn.columns.some((c) => near(c.x, p.x) && p.y >= c.y1 - TOL && p.y <= c.y2 + TOL),
    dot: drawn.dots.some((d) => near(d.x, p.x) && near(d.y, p.y)),
  };
}
export const onCrossing = (drawn: Drawn, p: Vec) => {
  const at = lineAt(drawn, p);
  return at.row && at.column;
};

export function uniq(values: number[]) {
  return [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
}

/** Rows and columns of the grid in the band of the view between `from` and `to` of the overlay's height. */
export function gridTargets(drawn: Drawn, world: World, overlay: { y: number; height: number }, from = 0.3, to = 0.9) {
  const top = (overlay.y - world.y) / world.zoom;
  const h = overlay.height / world.zoom;
  const rows = uniq(drawn.rows.map((r) => r.y)).filter((y) => y > top + h * from && y < top + h * to);
  const columns = uniq(drawn.columns.map((c) => c.x));
  const step = Math.round((rows[1] - rows[0]) * 100) / 100;
  return { rows, columns, step };
}

export class Ctx {
  world!: World;
  constructor(
    readonly page: Page,
    readonly client: CDPSession,
  ) {}
  toWindow = (p: Vec) => ({ x: this.world.x + p.x * this.world.zoom, y: this.world.y + p.y * this.world.zoom });
  async refresh() {
    this.world = await settledWorld(this.page);
    return this.world;
  }
  async draw(points: Vec[], alt = false, count = 1): Promise<Vec[][]> {
    const before = new Set((await this.page.evaluate(storedStrokes)).map((s) => s.id));
    await this.refresh();
    await pen(this.client, along(points).map(this.toWindow), alt);
    await expect
      .poll(async () => (await this.page.evaluate(storedStrokes)).length, { timeout: 120_000 })
      .toBe(before.size + count);
    const strokes = await this.page.evaluate(storedStrokes);
    return strokes.filter((s) => !before.has(s.id)).map((s) => s.points);
  }
  async shot(name: string, at: Vec, radius: number) {
    const c = this.toWindow(at);
    const z = this.world.zoom;
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      ...(this.page.viewportSize() ?? VIEWPORT),
      deviceScaleFactor: 4,
      mobile: false,
    });
    await this.page.waitForTimeout(300);
    const { data } = await this.client.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: c.x - radius * z, y: c.y - radius * z, width: 2 * radius * z, height: 2 * radius * z, scale: 1 },
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      ...(this.page.viewportSize() ?? VIEWPORT),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.page.waitForTimeout(300);
  }
}

export async function setZoom(
  page: Page,
  target: number,
  overlay: { x: number; y: number; width: number; height: number },
  at: Vec = { x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height / 2 },
) {
  // Ctrl+wheel zooms about the pointer, so the page point under `at` stays where it is.
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('Control');
  // Ctrl+wheel zooms by exp(-deltaY * k): measure k with one notch, then send the delta that lands on the target.
  const z0 = (await settledWorld(page)).zoom;
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400);
  const z1 = (await settledWorld(page)).zoom;
  const k = -Math.log(z1 / z0) / 100;
  for (let i = 0; i < 6; i += 1) {
    const { zoom } = await settledWorld(page);
    if (Math.abs(zoom - target) < 0.005) break;
    await page.mouse.wheel(0, -Math.log(target / zoom) / k);
    await page.waitForTimeout(400);
  }
  await page.keyboard.up('Control');
  return settledWorld(page);
}

/** Whether a Draw tab switch is on, read from the bar or from More (which this closes again). */
export async function isOn(page: Page, name: string): Promise<boolean> {
  const control = await drawControl(page, name);
  const state = (await control.getAttribute('aria-pressed')) ?? (await control.getAttribute('aria-checked'));
  if ((await control.getAttribute('role'))?.startsWith('menuitem')) await page.keyboard.press('Escape');
  return state === 'true';
}

/** The window's part of a page's paper: the rows and columns drawn in a band of the view, and their spacing. */
export function inView(world: World, overlay: { x: number; width: number }, xs: number[], margin = 80): number[] {
  return xs.filter(
    (x) =>
      world.x + x * world.zoom > overlay.x + margin && world.x + x * world.zoom < overlay.x + overlay.width - margin,
  );
}
