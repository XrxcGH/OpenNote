// The desk gutter (docs/BRAND.md amendments A11 to A13): at the Wide size class an open page sits on the desk between
// two strips of window light or evening sky, taken only from width the text column does not need. The column never
// narrows, a wheel, a pen or touch drag or a click in a strip still reaches the page, and the motifs stay clear of
// the paper, the edges, and every text box. Each is measured from boxes and pixels in the production build.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { VIEWPORTS } from '../screens';
import type { SizeClass, Theme } from '../screens';
import { runCommand } from './smart';

interface Options {
  width?: number;
  height?: number;
  theme?: Theme;
  paper?: boolean;
  mode?: 'Infinite canvas' | 'Document flow' | 'Pages with breaks';
  /** The page to open in Lectures. Membranes has blocks as wide as the viewport, which Fit width cannot go past. */
  name?: string;
}

async function openPage(page: Page, options: Options = {}): Promise<void> {
  const {
    width = 1440,
    height = 900,
    theme = 'light',
    paper = false,
    mode = 'Document flow',
    name = 'Membranes',
  } = options;
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    (appearance) => {
      window.__OPENNOTE_BOOT__ = { settings: { appearance }, bootVersion: 1 } as never;
    },
    { theme, pageColor: paper ? 'paper' : 'match' },
  );
  await page.setViewportSize({ width, height });
  await page.goto('/?fixture=sampler');
  const wide = width >= 1280;
  if (wide) {
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
    if (mode !== 'Infinite canvas') {
      await page.getByRole('tab', { name: 'View' }).click();
      await runCommand(page, 'Document flow');
      if (mode === 'Pages with breaks') await runCommand(page, 'Pages with breaks');
    }
  }
  await page.waitForLoadState('networkidle');
}

const gutter = (page: Page) =>
  page.evaluate(() => document.querySelector('main')?.getAttribute('data-desk-gutter') ?? null);

/** Waits for the gutter to read the given value (it is written after a measuring frame). */
async function expectGutter(page: Page, value: number): Promise<void> {
  await expect.poll(() => gutter(page), { timeout: 10_000 }).toBe(String(value));
}

/** The page's zoom in percent, from the title's drawn height against its layout height. */
const zoomPercent = (page: Page) =>
  page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-page-title]')!;
    return Math.round((title.getBoundingClientRect().height / title.offsetHeight) * 100);
  });

async function zoomTo(page: Page, percent: number): Promise<void> {
  await page.locator('[contenteditable] p').first().click();
  await page.keyboard.press('Control+Alt+0');
  for (let step = 0; step < 12 && (await zoomPercent(page)) < percent; step++)
    await page.keyboard.press('Control+Alt+Equal');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThanOrEqual(percent);
}

/** The flow column's width in CSS px. */
const columnWidth = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>('[data-layout]')!.getBoundingClientRect().width);

const boxes = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main')!.getBoundingClientRect();
    const paper = document.querySelector('main [data-scope="page"]')!.closest('article')!.getBoundingClientRect();
    return { main: main.toJSON(), paper: paper.toJSON() };
  });

for (const theme of ['light', 'dark'] as const) {
  for (const mode of ['Document flow', 'Infinite canvas'] as const) {
    test(`a 24 px gutter at 1,440 in ${mode}, ${theme}`, async ({ page }) => {
      await openPage(page, { theme, mode });
      await expectGutter(page, 24);
      const { main, paper } = await boxes(page);
      expect(Math.abs(paper.left - main.left - 24)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(main.right - paper.right - 24)).toBeLessThanOrEqual(0.5);
    });
  }
}

test.describe('the column never narrows', () => {
  for (const [width, height] of [
    [1280, 800],
    [1600, 900],
    [2000, 900],
  ] as const) {
    for (const percent of [100, 150]) {
      test(`at ${width} and ${percent} percent`, async ({ page }) => {
        await openPage(page, { width, height });
        if (percent !== 100) await zoomTo(page, percent);
        await page.waitForTimeout(400);
        const withGutter = await columnWidth(page);
        if (width === 2000) await expectGutter(page, 24);
        await page.evaluate(() => document.querySelector('main')!.setAttribute('data-desk-gutter-test', 'off'));
        await expectGutter(page, 0);
        await page.waitForTimeout(400);
        expect(Math.abs((await columnWidth(page)) - withGutter)).toBeLessThanOrEqual(0.5);
      });
    }
  }

  test('with Reading order open at 1,280', async ({ page }) => {
    await openPage(page, { width: 1280, height: 800 });
    await runCommand(page, 'Reading order');
    await expect(page.getByRole('complementary', { name: 'Reading order' })).toBeVisible();
    await expectGutter(page, 0);
  });
});

test('shrinks with the zoom: 19 px at 125 percent and none at 150 at 1,440', async ({ page }) => {
  await openPage(page);
  await zoomTo(page, 125);
  await expectGutter(page, 19);
  await zoomTo(page, 150);
  await expectGutter(page, 0);
});

test('gives way to a docked tool window at 1,600 without narrowing the column', async ({ page }) => {
  await openPage(page, { width: 1600 });
  await expectGutter(page, 24);
  await runCommand(page, 'Timers');
  await expect(page.locator('[data-tool="timers"]')).toBeVisible();
  await expect.poll(() => gutter(page)).not.toBe('24');
  await page.waitForTimeout(400);
  const withGutter = await columnWidth(page);
  await page.evaluate(() => document.querySelector('main')!.setAttribute('data-desk-gutter-test', 'off'));
  await expectGutter(page, 0);
  await page.waitForTimeout(400);
  expect(Math.abs((await columnWidth(page)) - withGutter)).toBeLessThanOrEqual(0.5);
});

for (const size of ['compact', 'medium', 'expanded'] as SizeClass[]) {
  test(`is absent at ${size}`, async ({ page }) => {
    await openPage(page, VIEWPORTS[size]);
    await expect.poll(() => gutter(page)).toMatch(/^(0|null)$/);
    expect(await page.locator('main [data-art="gutter-vine"]').evaluate((e) => getComputedStyle(e).display)).toBe(
      'none',
    );
  });
}

test('is 0 in Pages with breaks', async ({ page }) => {
  await openPage(page, { mode: 'Pages with breaks' });
  await expectGutter(page, 0);
});

test('is 0 with Paper in the dark theme', async ({ page }) => {
  await openPage(page, { theme: 'dark', paper: true, width: 1920 });
  await expectGutter(page, 0);
});

test('is 0 with Reading order and Contents open, and the page keeps 420 px', async ({ page }) => {
  await openPage(page);
  await runCommand(page, 'Reading order');
  await runCommand(page, 'Contents');
  await expectGutter(page, 0);
  const width = await page.evaluate(
    () => document.querySelector<HTMLElement>('main div[data-scope="page"]')!.clientWidth,
  );
  expect(width).toBeGreaterThanOrEqual(420);
});

test('@forced is 0 and the margin is 0', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openPage(page);
  await expectGutter(page, 0);
  const margin = await page.evaluate(() => getComputedStyle(document.querySelector('main article')!).marginLeft);
  expect(margin).toBe('0px');
});

test('holds the gutter through a Ctrl+wheel zoom until it settles', async ({ page }) => {
  await openPage(page);
  await expectGutter(page, 24);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const tick = () => {
      seen.push(document.querySelector('main')!.getAttribute('data-desk-gutter') ?? '');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = (await page.locator('main div[data-scope="page"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  for (let notch = 0; notch < 6; notch++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expectGutter(page, 0);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  // Until the zoom settled the gutter read 24 on every frame; the last frames read 0.
  const firstZero = seen.indexOf('0');
  expect(firstZero).toBeGreaterThan(0);
  expect(seen.slice(0, firstZero).every((value) => value === '24')).toBe(true);
});

// Fit width (flow.fitWidth measuring the viewport plus both strips) is covered by features/page/layout/fitWidthGutter.test.tsx.

test.describe('input in the strips reaches the page', () => {
  test('a wheel scrolls the page viewport, not main', async ({ page }) => {
    await openPage(page, { width: 1440, height: 500 });
    await expectGutter(page, 24);
    const main = (await boxes(page)).main;
    await page.mouse.move(main.right - 12, main.top + 200);
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLElement>('main div[data-scope="page"]')!.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => document.querySelector('main')!.scrollTop)).toBe(0);
  });

  test('a touch drag that starts in the left strip pans the viewport', async ({ page }) => {
    await openPage(page, { width: 1440, height: 500 });
    await expectGutter(page, 24);
    const main = (await boxes(page)).main;
    await page.evaluate(
      ({ x, y }) => {
        const target = document.querySelector('main')!;
        const send = (type: string, dy: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: 'touch',
              clientX: x,
              clientY: y + dy,
              bubbles: true,
              cancelable: true,
            }),
          );
        send('pointerdown', 0);
        send('pointermove', -120);
        send('pointerup', -120);
      },
      { x: main.left + 12, y: main.top + 300 },
    );
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLElement>('main div[data-scope="page"]')!.scrollTop))
      .toBeGreaterThan(0);
  });

  test('a click in a strip leaves the caret in the page text', async ({ page }) => {
    await openPage(page);
    await expectGutter(page, 24);
    const paragraph = page.locator('[contenteditable] p').first();
    await paragraph.click();
    const main = (await boxes(page)).main;
    for (const x of [main.left + 12, main.right - 12]) {
      await page.mouse.click(x, main.top + 300);
      expect(await page.evaluate(() => document.activeElement?.closest('[contenteditable]') !== null)).toBe(true);
    }
  });
});

test('a tool window keeps 8 px clear of the page scroll bar after the gutter returns', async ({ page }) => {
  await openPage(page, { width: 2000 });
  await runCommand(page, 'Timers');
  await expect(page.locator('[data-tool="timers"]')).toBeVisible();
  await expectGutter(page, 24);
  await zoomTo(page, 150);
  await expectGutter(page, 0);
  await zoomTo(page, 100);
  await expectGutter(page, 24);
  await page.waitForTimeout(500);
  const gaps = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('main div[data-scope="page"]')!;
    const bar = viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('[data-tool="timers"]')].map(
      (element) => element.getBoundingClientRect().left - bar,
    );
  });
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(8);
});

test.describe('the motifs', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`stay clear of the paper, the edges and all text in ${theme}`, async ({ page }) => {
      await openPage(page, { theme });
      await expectGutter(page, 24);
      const result = await page.evaluate(() => {
        const main = document.querySelector('main')!.getBoundingClientRect();
        const paper = document.querySelector('main article')!.getBoundingClientRect();
        const out: Record<string, { display: string; left: number; right: number; top: number; bottom: number }> = {};
        for (const name of ['gutter-vine', 'gutter-stars']) {
          const element = document.querySelector(`[data-art="${name}"]`)!;
          const r = element.getBoundingClientRect();
          out[name] = {
            display: getComputedStyle(element).display,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          };
        }
        return { main: main.toJSON(), paper: paper.toJSON(), out };
      });
      const { vine, stars } = { vine: result.out['gutter-vine']!, stars: result.out['gutter-stars']! };
      expect(vine.display).toBe('block');
      expect(result.paper.right - vine.left).toBeLessThan(0);
      expect(vine.left - result.paper.right).toBeGreaterThanOrEqual(4 - 0.5);
      expect(result.main.right - vine.right).toBeGreaterThanOrEqual(4 - 0.5);
      if (theme === 'dark') {
        expect(stars.display).toBe('block');
        expect(result.paper.left - stars.right).toBeGreaterThanOrEqual(-0.5);
      } else expect(stars.display).toBe('none');
    });
  }

  test('are hidden at 125 percent, with a page pane open and under more contrast', async ({ page }) => {
    await openPage(page, { theme: 'dark' });
    await expectGutter(page, 24);
    await zoomTo(page, 125);
    await expectGutter(page, 19);
    for (const name of ['gutter-vine', 'gutter-stars'])
      expect(await page.locator(`[data-art="${name}"]`).evaluate((e) => getComputedStyle(e).display)).toBe('none');
    await page.emulateMedia({ contrast: 'more', colorScheme: 'dark' } as never);
    await zoomTo(page, 100);
    await expectGutter(page, 24);
    for (const name of ['gutter-vine', 'gutter-stars'])
      expect(await page.locator(`[data-art="${name}"]`).evaluate((e) => getComputedStyle(e).display)).toBe('none');
  });
});

/** The red, green, and blue of a screenshot's pixels on a grid. */
async function samples(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ({ base64, width, height }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const out: { x: number; y: number; rgb: [number, number, number] }[] = [];
      for (let y = 0; y < height; y += 4)
        for (let x = 0; x < width; x += 4) {
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          out.push({ x, y, rgb: [r!, g!, b!] });
        }
      return out;
    },
    { base64: shot.toString('base64'), width: clip.width, height: clip.height },
  );
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

for (const theme of ['light', 'dark'] as const) {
  test(`the strips stay within 1.5:1 of the sunken canvas in ${theme}`, async ({ page }) => {
    await openPage(page, { theme });
    await expectGutter(page, 24);
    const sunken = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-surface-sunken)';
      document.body.append(probe);
      const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      return [r, g, b] as [number, number, number];
    });
    const { main } = await boxes(page);
    const motifs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-art^="gutter"]')].map((e) => e.getBoundingClientRect().toJSON()),
    );
    for (const side of [main.left, main.right - 24]) {
      for (const point of await samples(page, { x: side, y: main.top + 40, width: 24, height: 600 })) {
        const x = side + point.x;
        const y = main.top + 40 + point.y;
        if (motifs.some((m) => x >= m.left - 2 && x <= m.right + 2 && y >= m.top - 2 && y <= m.bottom + 2)) continue;
        expect(ratio(point.rgb, sunken)).toBeLessThanOrEqual(1.5);
      }
    }
  });
}

test('nothing in the strip animates, with or without reduced motion', async ({ page }) => {
  await openPage(page, { theme: 'dark' });
  await expectGutter(page, 24);
  await page.waitForTimeout(1000);
  // What animates in main's own strips, outside the page card: the page's own parts may (a spinner, a caret).
  const names = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState !== 'finished')
        .map((animation) => (animation.effect as KeyframeEffect | null)?.target as Element | null)
        .filter((target): target is Element => Boolean(target?.closest('main')) && !target?.closest('article'))
        .map((target) => `${target.tagName} ${target.getAttribute('class') ?? ''}`),
    );
  expect(await names()).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await names()).toEqual([]);
});
