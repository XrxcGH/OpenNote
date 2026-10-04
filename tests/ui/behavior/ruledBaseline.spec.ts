// Text on ruled, grid, and dot paper sits on the rules the way handwriting does, proved from the pixels of a
// screenshot rather than from the layout the page reports about itself. For every line of the ruled fixture (the
// title, the date under it, body text, inline large text, sub- and superscripts, every heading level, the three
// kinds of list, a quote, a callout, a code block, and a table), the lowest row of ink of its "Hxn" (letters that
// sit flat on the baseline) must be within a device pixel of a rule's row, and no rule may cross the letters above
// it. The rules are found by color in a column with no text in it, never from the page's own numbers.
//
// Text size is the WebView's zoom in the app, which a browser shows as a larger device scale factor over the same
// CSS viewport: 80 percent is a scale of 1.6 and 200 percent a scale of 4, over a scale of 2.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const PAPERS = [
  { menu: 'Lined, college', dots: false },
  { menu: 'Grid, 5 mm', dots: false },
  { menu: 'Dot grid', dots: true },
] as const;
const MODES = ['Infinite canvas', 'Pages with breaks'] as const;
const TEXT_SIZES = [80, 200] as const;
/** Ctrl+Alt+= steps the page zoom 100, 110, 125, 150. */
const ZOOMS = [
  { percent: 100, steps: 0 },
  { percent: 150, steps: 3 },
] as const;
/**
 * Columns of the page, in page units, with no text in them, where the rules show: the margin left of the title and
 * the text, and, where the paper leaves the sheet's margins blank (grid and dots on sheets), a column inside the
 * text column that the fixture's short lines never reach.
 */
const MARGIN_COLUMN = [2, 20] as const;
const TEXT_COLUMN = [400, 460] as const;
const FIXTURE_LINES = 32;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One run of letters to check, in CSS pixels of the window. */
interface Run {
  key: string;
  box: Box;
}

interface Scene {
  zoom: number;
  area: Box;
  band: readonly [number, number];
  runs: Run[];
}

/** What a screenshot holds: the rows of each rule, and the highest and lowest row of ink of each run. */
interface Pixels {
  rules: [number, number][];
  /** Runs of rows too tall for a rule: a box whose background hides the rules, or the space between sheets. */
  boxes: [number, number][];
  ink: Record<string, [number, number] | null>;
  bandWidth: number;
  height: number;
}

/** The page's layout as the window shows it: the page area, the rule column, and every "Hxn" on the page. */
function scene(column: readonly [number, number]): Scene {
  const world = document.querySelector<HTMLElement>('[data-ruled]');
  if (!world) throw new Error('The page is not on ruled paper');
  const rect = world.getBoundingClientRect();
  const zoom = rect.width / world.offsetWidth;
  let clip: HTMLElement | null = world.parentElement;
  while (clip && getComputedStyle(clip).overflow === 'visible') clip = clip.parentElement;
  const view = (clip ?? document.body).getBoundingClientRect();
  // The sheet counter floats over the bottom of the page area.
  const top = Math.max(view.y, 0);
  const right = Math.min(view.right, window.innerWidth);
  const area = {
    x: view.x,
    y: top,
    width: right - view.x,
    height: Math.min(view.bottom, window.innerHeight) - top - 48,
  };
  const box = (r: DOMRect): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const runs: Run[] = [];
  const walker = document.createTreeWalker(world, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    for (let at = text.indexOf('Hxn'); at !== -1; at = text.indexOf('Hxn', at + 3)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 3);
      const r = range.getClientRects()[0];
      const where = node.parentElement?.closest('h1,h2,h3,h4,h5,h6,li,pre,td,th,blockquote,[data-callout],p');
      if (r && r.width > 0)
        runs.push({ key: `${count} ${where?.tagName ?? ''} ${text.trim().slice(0, 24)}`, box: box(r) });
      count++;
    }
  }
  // The date under the title has no "Hxn": its "n" sits flat on the baseline too.
  const changed = document.querySelector('[data-page-title] + p')?.firstChild;
  const at = changed?.textContent?.indexOf('n') ?? -1;
  if (changed && at >= 0) {
    const range = document.createRange();
    range.setStart(changed, at);
    range.setEnd(changed, at + 1);
    const r = range.getClientRects()[0];
    if (r) runs.push({ key: 'date', box: box(r) });
  }
  return { zoom, area, band: [rect.x + column[0] * zoom, rect.x + column[1] * zoom], runs };
}

/** Reads a screenshot's pixels in a blank page: the rule rows in the band, and the ink rows of each run. */
async function readPixels(
  lab: Page,
  png: Buffer,
  clip: Box,
  band: readonly [number, number],
  runs: Run[],
  dots: boolean,
): Promise<Pixels> {
  return lab.evaluate(
    async ({ data, clip, band, runs, dots }) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const { width: W, height: H } = bitmap;
      const canvas = new OffscreenCanvas(W, H);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, W, H).data;
      const sx = W / clip.width;
      const sy = H / clip.height;
      const at = (x: number, y: number) => (y * W + x) * 4;
      // The paper's color: the commonest color in the rule column.
      const x0 = Math.max(0, Math.ceil((band[0] - clip.x) * sx));
      const x1 = Math.min(W, Math.floor((band[1] - clip.x) * sx));
      const counts = new Map<number, number>();
      for (let y = 0; y < H; y += 2) {
        for (let x = x0; x < x1; x++) {
          const i = at(x, y);
          const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const paper = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      const [pr, pg, pb] = [(paper >> 16) & 255, (paper >> 8) & 255, paper & 255];
      const paperLight = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      // A rule row: lined and grid paper mark most of the column, dots a few pixels of it. A run of marked rows
      // taller than a rule is a box with its own background, which hides the rules, and is no rule.
      const marked: boolean[] = [];
      for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = x0; x < x1; x++) {
          const i = at(x, y);
          if (Math.abs(pixels[i] - pr) + Math.abs(pixels[i + 1] - pg) + Math.abs(pixels[i + 2] - pb) > 24) n++;
        }
        marked.push(dots ? n >= 2 : n >= (x1 - x0) / 2);
      }
      const thickest = Math.ceil(4 * sy) + 2;
      const rules: [number, number][] = [];
      const boxes: [number, number][] = [];
      for (let y = 0; y < H; y++) {
        if (!marked[y]) continue;
        let end = y;
        while (end + 1 < H && marked[end + 1]) end++;
        if (end - y + 1 > thickest) boxes.push([y, end]);
        else if (y > 0 && end < H - 1) rules.push([y, end]);
        y = end;
      }
      // Ink: dark, colorless pixels (a spelling squiggle is red, rules and highlights are light).
      const ink: Record<string, [number, number] | null> = {};
      for (const run of runs) {
        const left = Math.round((run.box.x - clip.x) * sx) + 1;
        const right = Math.round((run.box.x + run.box.width - clip.x) * sx) - 1;
        const top = Math.max(0, Math.floor((run.box.y - clip.y) * sy) - 2);
        const bottom = Math.min(H - 1, Math.ceil((run.box.y + run.box.height - clip.y) * sy) + 2);
        const inked = (y: number) => {
          for (let x = left; x <= right; x++) {
            const i = at(x, y);
            const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
            const light = 0.299 * r + 0.587 * g + 0.114 * b;
            if (light < paperLight * 0.55 && Math.max(r, g, b) - Math.min(r, g, b) < 60) return true;
          }
          return false;
        };
        // The letters are one block of rows with ink: the one at the middle of the run's box. Ink above or below it
        // with paper between (the line above's descenders, the line below's capitals) belongs to other lines.
        let middle = Math.round((top + bottom) / 2);
        for (let d = 0; d <= (bottom - top) / 2 && !inked(middle); d++) {
          if (inked(middle - d)) middle -= d;
          else if (inked(middle + d)) middle += d;
        }
        if (!inked(middle)) {
          ink[run.key] = null;
          continue;
        }
        let first = middle;
        let last = middle;
        while (first > top && inked(first - 1)) first--;
        while (last < bottom && inked(last + 1)) last++;
        ink[run.key] = [first, last];
      }
      return { rules, boxes, ink, bandWidth: x1 - x0, height: H };
    },
    { data: png.toString('base64'), clip, band, runs, dots },
  );
}

/**
 * The rules, with the ones a box hides put back: between two rules seen in the column, a gap of a whole number of
 * spacings holds that many rules, evenly spaced (a gap that is not whole is the edge of a sheet), and a box that
 * hides the rules holds the rules that continue the nearest rule seen above it, or below it.
 */
function lattice(seen: [number, number][], boxes: [number, number][]): { rules: [number, number][]; period: number } {
  const steps = seen.slice(1).map((rule, i) => (rule[0] + rule[1]) / 2 - (seen[i][0] + seen[i][1]) / 2);
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  // The spacing to a fraction of a pixel: every gap that is a whole number of spacings, divided by that number.
  const whole = steps.filter((gap) => Math.abs(gap / median - Math.round(gap / median)) < 0.1);
  const period = whole.reduce((sum, gap) => sum + gap / Math.round(gap / median), 0) / whole.length;
  const rules: [number, number][] = [];
  seen.forEach((rule, i) => {
    rules.push(rule);
    const next = seen[i + 1];
    if (!next) return;
    const gap = (next[0] + next[1]) / 2 - (rule[0] + rule[1]) / 2;
    const n = Math.round(gap / period);
    if (n < 2 || Math.abs(gap / period - n) > 0.1) return;
    for (let k = 1; k < n; k++) rules.push([rule[0] + (k * gap) / n, rule[1] + (k * gap) / n]);
  });
  const middle = (rule: [number, number]) => (rule[0] + rule[1]) / 2;
  for (const [a, b] of boxes) {
    // Each hidden rule continues the nearer of the rules seen above and below the box: a box can run across the
    // edge of a sheet, where the rules start again.
    const above = seen.filter((rule) => rule[1] < a).at(-1);
    const below = seen.find((rule) => rule[0] > b);
    for (const from of [above, below]) {
      if (!from) continue;
      const other = from === above ? below : above;
      const half = (from[1] - from[0]) / 2;
      for (let y = middle(from) + Math.round((a - middle(from)) / period - 1) * period; y <= b + period; y += period) {
        if (y < a - period / 2 || y > b + period / 2) continue;
        if (other && Math.abs(y - middle(other)) < Math.abs(y - middle(from))) continue;
        if (rules.some((rule) => Math.abs(middle(rule) - y) < period / 4)) continue;
        rules.push([y - half, y + half]);
      }
    }
  }
  return { rules, period };
}

async function openRuledPage(page: Page, paper: string, mode: string): Promise<void> {
  await page.goto('/?fixture=ruled');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Hxn after the table.')).toBeVisible({ timeout: 20_000 });
  // The title, renamed to letters that sit flat on the baseline.
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Hxn');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByRole('tab', { name: 'View' }).click();
  const bar = page.getByRole('toolbar');
  const press = async (name: string) => {
    const button = bar.getByRole('button', { name, exact: true });
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  };
  // A page starts in document flow. With the pane buttons in the bar, Document flow no longer fits at this width
  // and sits under More, so it is pressed only where it shows.
  if ((await bar.getByRole('button', { name: 'Document flow', exact: true }).count()) > 0) await press('Document flow');
  await press(mode);
  await bar.getByRole('button', { name: 'Background' }).click();
  await page.getByRole('menuitemradio', { name: paper }).click();
  await expect(page.locator('[data-ruled]')).toHaveCount(1);
}

async function setZoom(page: Page, steps: number, percent: number): Promise<void> {
  // The page zoom keys work with the focus in the page.
  await page.getByText('Hxn after the table.').click();
  await page.keyboard.press('Control+Alt+0');
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+Alt+Equal');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('[data-ruled]')!.getBoundingClientRect().width))
    .toBeGreaterThan(0);
  const zoom = () =>
    page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('[data-ruled]')!;
      return Math.round((world.getBoundingClientRect().width / world.offsetWidth) * 100);
    });
  await expect.poll(zoom).toBe(percent);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

for (const size of TEXT_SIZES) {
  test.describe(`at ${size} percent text`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: (2 * size) / 100 });

    for (const paper of PAPERS) {
      for (const mode of MODES) {
        test(`every line sits on a rule: ${paper.menu}, ${mode}`, async ({ page, context }) => {
          test.slow();
          await openRuledPage(page, paper.menu, mode);
          const lab = await context.newPage();
          for (const zoom of ZOOMS) {
            await setZoom(page, zoom.steps, zoom.percent);
            const results = new Map<string, string | null>();
            let total = 0;
            // The page is taller than the window: scroll it to its top left, then down a screen at a time.
            const blankMargins = mode === 'Pages with breaks' && !paper.menu.startsWith('Lined');
            const column = blankMargins ? TEXT_COLUMN : MARGIN_COLUMN;
            const start = await page.evaluate(scene, column);
            const middle = { x: start.area.x + start.area.width / 2, y: start.area.y + start.area.height / 2 };
            await page.mouse.move(middle.x, middle.y);
            await page.mouse.wheel(-4000, -8000);
            for (let pass = 0; pass < 14; pass++) {
              await page.mouse.move(0, 0);
              await page.waitForTimeout(250);
              const now = await page.evaluate(scene, column);
              total = now.runs.length;
              const inside = (b: Box) =>
                b.y >= now.area.y + 2 && b.y + b.height <= now.area.y + now.area.height - 2 && b.x >= now.area.x;
              const fresh = now.runs.filter((run) => inside(run.box) && !results.has(run.key));
              expect(now.band[1], 'the rule column is on screen').toBeLessThan(now.area.x + now.area.width);
              if (fresh.length > 0) {
                const clip = now.area;
                const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
                const pixels = await readPixels(lab, png, clip, now.band, fresh, paper.dots);
                expect(pixels.rules.length, 'rules seen in the column').toBeGreaterThan(3);
                const { rules, period } = lattice(pixels.rules, pixels.boxes);
                for (const run of fresh) {
                  const ink = pixels.ink[run.key];
                  if (!ink) {
                    results.set(run.key, 'no ink found');
                    continue;
                  }
                  const [top, bottom] = ink;
                  // Inside a box that runs off the screenshot, the rules on the far side are not in view: a later
                  // screenshot judges the line.
                  const cut = pixels.boxes.some(
                    ([a, b]) => bottom >= a && bottom <= b && (a === 0 || b >= pixels.height - 1),
                  );
                  if (cut) continue;
                  const on = rules.some(([s, e]) => bottom >= s - 1 && bottom <= e + 1);
                  const crossed = rules.some(([s, e]) => s > top && e < bottom - 1);
                  const tall = bottom - top >= period;
                  const nearest = rules.reduce((best, [s, e]) => {
                    const d = bottom < s ? s - bottom : bottom > e ? bottom - e : 0;
                    return Math.min(best, d);
                  }, Infinity);
                  const problem = !on
                    ? `its ink ends ${nearest.toFixed(1)} device px from a rule`
                    : crossed && !tall
                      ? 'a rule crosses its letters'
                      : null;
                  results.set(run.key, problem);
                }
              }
              if (results.size >= total && total > 0) break;
              await page.mouse.move(middle.x, middle.y);
              await page.mouse.wheel(0, now.area.height * 0.55);
            }
            const failures = [...results].filter(([, problem]) => problem !== null);
            expect(total, 'the fixture is on the page').toBeGreaterThanOrEqual(FIXTURE_LINES);
            expect(results.size, `every line was checked at ${zoom.percent}%`).toBe(total);
            expect(failures, `lines off the rules at ${zoom.percent}% zoom`).toEqual([]);
          }
          await lab.close();
        });
      }
    }
  });
}
