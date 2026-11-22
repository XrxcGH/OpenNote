// The desk gutter (docs/BRAND.md amendments A11 to A13): at the Wide size class an open page sits on the desk between
// two strips of window light or evening sky, taken only from width the text column does not need. The column never
// narrows. A wheel, a pen or touch drag, or a click in a strip still reaches the page. Each is measured from boxes in
// the production build.

import { test, expect } from '../fixtures';
import { VIEWPORTS } from '../screens';
import type { SizeClass } from '../screens';
import { runCommand } from './smart';
import { quiet, boxes, columnWidth, expectGutter, gutter, openPage, zoomPercent, zoomTo } from './deskGutterKit';

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
    await page.waitForTimeout(400);
    const withGutter = await columnWidth(page);
    await page.evaluate(() => document.querySelector('main')!.setAttribute('data-desk-gutter-test', 'off'));
    await expectGutter(page, 0);
    await page.waitForTimeout(400);
    expect(Math.abs((await columnWidth(page)) - withGutter)).toBeLessThanOrEqual(0.5);
  });

  test('when the note size grows, the gutter gives way at once', async ({ page }) => {
    await openPage(page, { width: 1280, height: 800 });
    await expectGutter(page, 24);
    // A larger reading size makes 72ch wider than the region leaves: the rule runs again without a resize.
    await page.evaluate(() => document.documentElement.style.setProperty('--type-note-size', '21px'));
    await expectGutter(page, 0);
    await page.waitForTimeout(400);
    const withGutter = await columnWidth(page);
    await page.evaluate(() => document.querySelector('main')!.setAttribute('data-desk-gutter-test', 'off'));
    await expectGutter(page, 0);
    await page.waitForTimeout(400);
    expect(Math.abs((await columnWidth(page)) - withGutter)).toBeLessThanOrEqual(0.5);
  });
});

test('shrinks with the zoom: 19 px at 125 percent and none at 150 at 1,440', async ({ page }) => {
  await openPage(page);
  await zoomTo(page, 125);
  await expectGutter(page, 19);
  await zoomTo(page, 150);
  await expectGutter(page, 0);
});

test('is 0 beside a docked 360 px tool window at 1,440, and the column keeps its width', async ({ page }) => {
  await openPage(page);
  await expectGutter(page, 24);
  // The dock takes its width from the page region (dock.ts): 360 px leaves the column no spare width.
  await page.evaluate(() => document.documentElement.style.setProperty('--dock-inset-right', '360px'));
  await expectGutter(page, 0);
  await page.waitForTimeout(400);
  const withGutter = await columnWidth(page);
  await page.evaluate(() => document.querySelector('main')!.setAttribute('data-desk-gutter-test', 'off'));
  await expectGutter(page, 0);
  await page.waitForTimeout(400);
  expect(Math.abs((await columnWidth(page)) - withGutter)).toBeLessThanOrEqual(0.5);
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
    if (size !== 'compact') {
      if (size === 'medium') await page.getByRole('button', { name: 'Show notebooks' }).click();
      await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
      await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
      await quiet(page);
    }
    // The editing surface fills main's content box: no gutter margin remains.
    const fit = await page.evaluate(() => {
      const element = document.querySelector('main')!;
      const main = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const card = document.querySelector('main article')!.getBoundingClientRect();
      return {
        left: card.left - main.left - Number.parseFloat(style.paddingLeft),
        right: main.right - card.right - Number.parseFloat(style.paddingRight),
      };
    });
    expect(Math.abs(fit.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(fit.right)).toBeLessThanOrEqual(0.5);
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

// Fit page to width measures the viewport plus both strips (flow.fitWidth); the gutter then settles to 0 and the
// content ends at the viewport's right edge, to within the whole-percent step of the zoom.
test('Fit page to width at 1,440 settles the gutter to 0 and the content to the right edge', async ({ page }) => {
  await openPage(page);
  await expectGutter(page, 24);
  const before = await zoomPercent(page);
  await page.locator('[contenteditable] p').first().click();
  await runCommand(page, 'Fit page to width');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  await expectGutter(page, 0);
  await page.waitForTimeout(500);
  const gap = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('main div[data-scope=page]')!;
    const flow = viewport.querySelector<HTMLElement>('[data-layout]')!;
    const right = viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth;
    return { gap: right - flow.getBoundingClientRect().right, scrolls: viewport.scrollWidth > viewport.clientWidth };
  });
  // The fit leaves the flow's own left margin on the right as well, and rounds the zoom down by under one percent.
  expect(gap.scrolls).toBe(false);
  const margin = await page.evaluate(() => {
    const flow = document.querySelector<HTMLElement>('main [data-layout]')!;
    return (
      flow.getBoundingClientRect().left - flow.closest<HTMLElement>('[data-scope="page"]')!.getBoundingClientRect().left
    );
  });
  expect(Math.abs(gap.gap - margin)).toBeLessThanOrEqual(10);
});

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

  test('a Ctrl+wheel in a strip zooms the page', async ({ page }) => {
    await openPage(page, { width: 1440, height: 500 });
    await expectGutter(page, 24);
    const before = await zoomPercent(page);
    const main = (await boxes(page)).main;
    await page.mouse.move(main.right - 12, main.top + 200);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(before);
  });

  test('a strip takes touch input as a pan, not as the browser scrolling or zooming', async ({ page }) => {
    await openPage(page, { width: 1440, height: 500 });
    await expectGutter(page, 24);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('main')!).touchAction)).toBe('none');
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
