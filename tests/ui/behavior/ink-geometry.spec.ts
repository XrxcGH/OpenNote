// The measuring ruler, the measure, and the compass in the real interface, with pen input sent through the DevTools
// Protocol on grid paper. The ruler switches its ticks between centimeters and inches. The measure shows a distance
// and draws nothing. The compass's center and radius snap to the grid's crossings, and a full sweep stores one circle
// whose points all lie at that radius from its center, and a part sweep stores an arc. A line drawn along the ruler is
// held straight to its edge and its length is read out. The ruler moves by drag and by keys, and the measure works from
// the keyboard.
import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { press } from '../paperSnap';

/** Wide enough for the Draw tab to show its snap group. */
const VIEWPORT = { width: 1920, height: 1000 };
/** The grid paper's spacing, 5 mm in page units. */
const STEP = 5 * 3.7795;

interface Vec {
  x: number;
  y: number;
}

async function openGrid(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await page.getByRole('tab', { name: 'View' }).click();
  const bar = page.getByRole('toolbar');
  const mode = bar.getByRole('button', { name: 'Pages with breaks', exact: true });
  if ((await mode.getAttribute('aria-pressed')) !== 'true') await mode.click();
  await bar.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('menuitemradio', { name: 'Grid, 5 mm', exact: true }).click();
  await expect(page.locator('[data-ruled]')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Draw' }).click();
  await expect(page.locator('[data-ink-overlay]')).toHaveCount(1);
}

/** Turns a Draw tab switch on, wherever the bar shows it: in its group, or under More when the bar is too narrow. */
async function turnOn(page: Page, name: string): Promise<void> {
  const bar = page.getByRole('toolbar', { name: 'Draw' });
  const button = bar.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    if ((await button.first().getAttribute('aria-pressed')) !== 'true') await button.first().click();
    await expect(button.first()).toHaveAttribute('aria-pressed', 'true');
    return;
  }
  await bar.getByRole('button', { name: 'More commands', exact: true }).click();
  const item = page.getByRole('menu', { name: 'More commands' }).getByRole('menuitemcheckbox', { name, exact: true });
  if ((await item.getAttribute('aria-checked')) !== 'true') await item.click();
  else await page.keyboard.press('Escape');
}

/** Chooses the ruler's units in the group's Units menu, or under More. */
async function chooseUnits(page: Page, name: 'Units: inches' | 'Units: centimeters'): Promise<void> {
  const bar = page.getByRole('toolbar', { name: 'Draw' });
  const button = bar.getByRole('button', { name: 'Units', exact: true });
  if ((await button.count()) > 0 && (await button.first().isVisible())) {
    await button.first().click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    return;
  }
  await bar.getByRole('button', { name: 'More commands', exact: true }).click();
  await page.getByRole('menu', { name: 'More commands' }).getByRole('menuitemcheckbox', { name, exact: true }).click();
}

async function pen(client: CDPSession, points: readonly Vec[]): Promise<void> {
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', p: Vec, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      x: p.x,
      y: p.y,
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
      force: buttons ? 0.5 : 0,
    });
  await send('mousePressed', points[0], 1);
  for (const p of points.slice(1)) await send('mouseMoved', p, 1);
  await send('mouseReleased', points[points.length - 1], 0);
}

/** The page's shape strokes' points in page units, decoded from the page service's records. */
function storedPoints(): Vec[][] {
  const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
  const held = hooks.pagesHeld() as {
    memoryInk?: Record<string, { channels: number; pointCount: number; points: Uint8Array }>;
  };
  return Object.values(held.memoryInk ?? {}).map((stroke) => {
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
    return out;
  });
}

test.describe('geometry tools', () => {
  test.use({ viewport: VIEWPORT });

  test('the ruler shows centimeters or inches', async ({ page }) => {
    await openGrid(page);
    await turnOn(page, 'Ruler');
    await expect(page.locator('[data-ink-ticks="metric"], [data-ink-ticks="imperial"]')).toHaveCount(1);
    await chooseUnits(page, 'Units: inches');
    await expect(page.locator('[data-ink-ticks="imperial"]')).toHaveCount(1);
    await chooseUnits(page, 'Units: centimeters');
    await expect(page.locator('[data-ink-ticks="metric"]')).toHaveCount(1);
  });

  test('the measure reads a distance and draws nothing', async ({ page }) => {
    await openGrid(page);
    const client = await page.context().newCDPSession(page);
    const before = (await page.evaluate(storedPoints)).length;
    await turnOn(page, 'Measure');
    await pen(client, [
      { x: 700, y: 500 },
      { x: 760, y: 500 },
      { x: 840, y: 500 },
    ]);
    await expect(page.locator('[data-ink-measure]')).toHaveText(/^[\d.]+ (cm|in) at 0 degrees$/);
    expect((await page.evaluate(storedPoints)).length).toBe(before);
  });

  test('the compass snaps to the grid and draws one circle', async ({ page }) => {
    await openGrid(page);
    const client = await page.context().newCDPSession(page);
    const before = (await page.evaluate(storedPoints)).length;
    await turnOn(page, 'Compass');
    // Tap the center, open the compass to the right, then sweep all the way around.
    await pen(client, [{ x: 803, y: 503 }]);
    const needle = page.locator('[data-ink-compass]');
    await expect(needle).toBeVisible();
    const box = (await needle.boundingBox())!;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await pen(client, [c, { x: c.x + 40, y: c.y }, { x: c.x + 82, y: c.y + 2 }]);
    await expect(page.locator('[data-ink-compass-radius]')).toHaveText(/^Radius [\d.]+ (cm|in)$/);
    const sweep = Array.from({ length: 41 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2;
      return { x: c.x + 80 * Math.cos(a), y: c.y + 80 * Math.sin(a) };
    });
    await pen(client, sweep);
    await expect.poll(async () => (await page.evaluate(storedPoints)).length).toBe(before + 1);
    const circle = (await page.evaluate(storedPoints)).at(-1)!;
    // The middle of its bounds is the center: a sampled outline repeats its first point, so an average leans.
    const xs = circle.map((p) => p.x);
    const ys = circle.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const radii = circle.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const r = radii.reduce((sum, v) => sum + v, 0) / radii.length;
    for (const one of radii) expect(Math.abs(one - r)).toBeLessThan(0.5);
    // Opened from one grid crossing to another along a row, the radius is a whole number of squares.
    expect(Math.abs(r / STEP - Math.round(r / STEP))).toBeLessThan(0.05);
  });
  test('a line drawn along the ruler is straight and its length is read out', async ({ page }) => {
    await openGrid(page);
    const client = await page.context().newCDPSession(page);
    await turnOn(page, 'Ruler');
    await chooseUnits(page, 'Units: centimeters');
    await press(page, 'Pen, Ink, 0.5 mm', true);
    const before = (await page.evaluate(storedPoints)).length;
    const box = (await page.locator('[data-ink-widget="ruler"]').boundingBox())!;
    // Start just above the top edge, on the page, and wander up to 4 px either side of it.
    const line = Array.from({ length: 31 }, (_, i) => ({ x: 700 + i * 10, y: box.y - 5 + 4 * Math.sin(i) }));
    await pen(client, line);
    await expect.poll(async () => (await page.evaluate(storedPoints)).length).toBe(before + 1);
    const stroke = (await page.evaluate(storedPoints)).at(-1)!;
    const ys = stroke.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.1);
    await expect(page.locator('[data-ink-readout="ruler"]')).toHaveText(/^[\d.]+ cm along the ruler$/);
  });

  test('the ruler moves by drag and by the arrow keys', async ({ page }) => {
    await openGrid(page);
    await turnOn(page, 'Ruler');
    await chooseUnits(page, 'Units: centimeters');
    const ruler = page.locator('[data-ink-widget="ruler"]');
    const box = (await ruler.boundingBox())!;
    const mid = { x: box.x + box.width / 3, y: box.y + box.height / 2 };
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y + 40, { steps: 6 });
    await page.mouse.up();
    const moved = (await ruler.boundingBox())!;
    expect(moved.x - box.x).toBeCloseTo(60, 0);
    expect(moved.y - box.y).toBeCloseTo(40, 0);
    // Ten presses move it 10 mm: a thirtieth of its 30 cm length.
    await ruler.focus();
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    const keyed = (await ruler.boundingBox())!;
    expect(keyed.x - moved.x).toBeCloseTo(moved.width / 30, 0);
  });

  test('the measure works from the keyboard', async ({ page }) => {
    await openGrid(page);
    await chooseUnits(page, 'Units: centimeters');
    await turnOn(page, 'Measure');
    const cursor = page.locator('[data-ink-measure-cursor]');
    await expect(cursor).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ink-measure]')).toHaveText('2.0 cm at 0 degrees');
  });

  test('a part sweep of the compass stores an arc', async ({ page }) => {
    await openGrid(page);
    const client = await page.context().newCDPSession(page);
    const before = (await page.evaluate(storedPoints)).length;
    await turnOn(page, 'Compass');
    await pen(client, [{ x: 803, y: 503 }]);
    const needle = page.locator('[data-ink-compass]');
    await expect(needle).toBeVisible();
    await expect(page.locator('[data-ink-compass-hint]')).toHaveText('Drag out from the center to open');
    const box = (await needle.boundingBox())!;
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await pen(client, [c, { x: c.x + 40, y: c.y }, { x: c.x + 82, y: c.y + 2 }]);
    await expect(page.locator('[data-ink-compass-hint]')).toContainText('drag from the center to resize');
    // A quarter turn, clockwise on the screen from the right.
    const sweep = Array.from({ length: 11 }, (_, i) => {
      const a = (i / 10) * (Math.PI / 2);
      return { x: c.x + 80 * Math.cos(a), y: c.y + 80 * Math.sin(a) };
    });
    await pen(client, sweep);
    await expect.poll(async () => (await page.evaluate(storedPoints)).length).toBe(before + 1);
    const arc = (await page.evaluate(storedPoints)).at(-1)!;
    // The circle through its ends and its middle: every point lies on it, and the ends are a quarter turn apart.
    const [a, b, e] = [arc[0], arc[Math.floor(arc.length / 2)], arc.at(-1)!];
    const d = 2 * (a.x * (b.y - e.y) + b.x * (e.y - a.y) + e.x * (a.y - b.y));
    const sq = (p: Vec) => p.x * p.x + p.y * p.y;
    const center = {
      x: (sq(a) * (b.y - e.y) + sq(b) * (e.y - a.y) + sq(e) * (a.y - b.y)) / d,
      y: (sq(a) * (e.x - b.x) + sq(b) * (a.x - e.x) + sq(e) * (b.x - a.x)) / d,
    };
    const r = Math.hypot(a.x - center.x, a.y - center.y);
    for (const p of arc) expect(Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r)).toBeLessThan(0.5);
    const turn = Math.abs(Math.atan2(e.y - center.y, e.x - center.x) - Math.atan2(a.y - center.y, a.x - center.x));
    expect((turn * 180) / Math.PI).toBeCloseTo(90, -1);
  });
});
