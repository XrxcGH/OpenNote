// Geometry the owner checks by eye (October 2026 review): Trash centered in its footer, pane widths that follow the
// window, panels between the toolbar and the status bar, the title in line with the text, and the Properties chip
// inside the page. Each is measured from bounding boxes, at the window widths and zoom levels people use.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen, VIEWPORTS } from '../screens';
import { runCommand } from './smart';

const WIDTHS = [1280, 1600, 2000] as const;

async function openMembranes(page: Page, width: number, fixture = 'smart') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  // The page's commands are listed only once the page is shown and their chunks have loaded.
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
}

/** The command bar's bottom edge (its divider line included) and the status line's top, in CSS px. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-region="commandBar"]')!.getBoundingClientRect();
    const status = [...document.querySelectorAll('main div')].find(
      (element) => element.children.length < 4 && /^\d+ words?/.test(element.textContent ?? ''),
    );
    return { top: bar.bottom, bottom: status?.getBoundingClientRect().top ?? window.innerHeight };
  });

/** Opens a tool from the command palette, with the caret in the page's text. */
async function openTool(page: Page, name: string) {
  await page.locator('[contenteditable=true] p').first().click();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a command or a page name').fill(name);
  await page.getByRole('option', { name }).first().click();
}

test.describe('the notebooks pane footer', () => {
  for (const width of WIDTHS) {
    test(`Trash and the plant sit centered in the footer box at ${width}`, async ({ page }) => {
      await openMembranes(page, width);
      const trash = page.getByRole('button', { name: 'Trash', exact: true });
      const footer = await trash.evaluate((button) => {
        const box = button.parentElement!.getBoundingClientRect();
        const pane = button.closest('[data-region="notebooks"]')!.getBoundingClientRect();
        const plant = button.parentElement!.querySelector(':scope > svg')?.getBoundingClientRect();
        // The box the footer's line draws: from under the line to the pane's bottom edge.
        return { top: box.top + 1, bottom: pane.bottom, plant: plant && (plant.top + plant.bottom) / 2 };
      });
      const box = (await trash.boundingBox())!;
      const middle = (footer.top + footer.bottom) / 2;
      expect(Math.abs(box.y + box.height / 2 - middle)).toBeLessThanOrEqual(1);
      expect(footer.plant, 'the plant shows beside Trash').toBeDefined();
      expect(Math.abs(footer.plant! - middle)).toBeLessThanOrEqual(1);
    });
  }
});

/** The left edges of the title's text and of the first line of body text, in CSS px. */
const textEdges = (page: Page) =>
  page.evaluate(() => {
    const left = (element: Element | null) => {
      if (!element) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects()[0]?.left ?? Number.NaN;
    };
    return {
      title: left(document.querySelector('[data-page-title]')),
      text: left(document.querySelector('[contenteditable] p, [data-block-id] p')),
    };
  });

/** Page zoom in percent: the title's drawn height against its layout height. */
const pageZoom = (page: Page) =>
  page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-page-title]')!;
    return Math.round((title.getBoundingClientRect().height / title.offsetHeight) * 100);
  });

test.describe('the page title lines up with the text', () => {
  // Backgrounds are picked from the View tab, whose Background button shows in the bar at 2000.
  const papers: [width: number, mode: string, background: string | null][] = [
    [1280, 'Infinite canvas', null],
    [1280, 'Document flow', null],
    [1280, 'Pages with breaks', null],
    [2000, 'Infinite canvas', null],
    [2000, 'Document flow', 'Plain'],
    [2000, 'Document flow', 'Dot grid'],
    [2000, 'Document flow', 'Lined, college'],
    [2000, 'Pages with breaks', 'Plain'],
    [2000, 'Pages with breaks', 'Grid, 5 mm'],
  ];
  {
    for (const [width, mode, background] of papers) {
      test(`${mode}${background ? `, ${background}` : ''} at ${width}, 100% and 150%`, async ({ page }) => {
        await openMembranes(page, width, 'sampler');
        if (mode !== 'Infinite canvas') {
          // The view's commands come on once the pages feature has loaded; the View tab shows when it has.
          await page.getByRole('tab', { name: 'View' }).click();
          await expect(page.getByRole('toolbar').getByRole('button', { name: 'Infinite canvas' })).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await runCommand(page, 'Document flow');
        }
        if (mode === 'Pages with breaks') await runCommand(page, 'Pages with breaks');
        if (background) {
          await page.getByRole('tab', { name: 'View' }).click();
          await page.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
          await page.getByRole('menuitemradio', { name: background }).click();
        }
        await expect
          .poll(async () => Math.abs((await textEdges(page)).title - (await textEdges(page)).text))
          .toBeLessThanOrEqual(1);
        await page.locator('[contenteditable] p').first().click();
        await page.keyboard.press('Control+Alt+0');
        for (let step = 0; step < 6 && (await pageZoom(page)) < 150; step++)
          await page.keyboard.press('Control+Alt+Equal');
        expect(await pageZoom(page)).toBeGreaterThanOrEqual(150);
        await expect
          .poll(async () => Math.abs((await textEdges(page)).title - (await textEdges(page)).text))
          .toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe('panels stay between the toolbar and the status line', () => {
  for (const [width, height] of [
    [1280, 900],
    [1600, 900],
    [2000, 900],
    [1280, 600],
  ] as const) {
    for (const tool of ['Citations', 'Timers']) {
      test(`${tool} at ${width} by ${height}`, async ({ page }) => {
        await openMembranes(page, width);
        await page.setViewportSize({ width, height });
        await openTool(page, `Open ${tool.toLowerCase()}`);
        const panel = page.getByRole('dialog', { name: tool });
        await expect(panel).toBeVisible();
        await expect
          .poll(async () => (await chrome(page)).bottom, { message: 'the status line shows' })
          .toBeLessThan(height);
        const edges = await chrome(page);
        const box = (await panel.boundingBox())!;
        expect(box.y, 'below the command bar and its line').toBeGreaterThanOrEqual(edges.top - 1);
        expect(box.y + box.height, 'above the status line').toBeLessThanOrEqual(edges.bottom + 1);
      });
    }
  }
});

// checks-disable-next-line modifiability: one describe over the widths and schemes that share each case
test.describe('a docked panel leaves the page alone', () => {
  for (const width of [1600, 2000] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`Citations at ${width}, ${scheme}, shares no pixel with page text, title, chip or divider`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openMembranes(page, width);
        await openTool(page, 'Open citations');
        const panel = page.getByRole('dialog', { name: 'Citations' });
        await expect(panel).toBeVisible();
        const edges = await chrome(page);
        const found = await page.evaluate(() => {
          const rect = (element: Element | null) => {
            const box = element?.getBoundingClientRect();
            return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null;
          };
          const texts: { left: number; right: number; top: number; bottom: number }[] = [];
          const editor = document.querySelector('[contenteditable=true]')!;
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const box of range.getClientRects()) {
              texts.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
            }
          }
          const main = document.querySelector('main')!.getBoundingClientRect();
          return {
            texts,
            title: rect(document.querySelector('[data-page-title]')),
            chip: rect(
              [...document.querySelectorAll('button')].find((one) => /^Properties/.test(one.textContent ?? '')) ?? null,
            ),
            mainRight: main.right,
          };
        });
        const box = (await panel.boundingBox())!;
        const hits = (one: { left: number; right: number; top: number; bottom: number } | null) =>
          !!one &&
          one.right > box.x &&
          one.left < box.x + box.width &&
          one.bottom > box.y &&
          one.top < box.y + box.height;
        expect(found.texts.length).toBeGreaterThan(0);
        expect(found.texts.filter(hits), 'page text under the panel').toEqual([]);
        expect(hits(found.title), 'the title under the panel').toBe(false);
        expect(hits(found.chip), 'the Properties chip under the panel').toBe(false);
        expect(found.mainRight, 'the page region, its scroll bar included, ends at the panel').toBeLessThanOrEqual(
          box.x + 1,
        );
        expect(box.y, 'top at or below the toolbar divider').toBeGreaterThanOrEqual(edges.top - 1);
        expect(box.y + box.height, 'bottom at or above the status bar').toBeLessThanOrEqual(edges.bottom + 1);
        expect(box.x + box.width, 'at the right edge').toBeGreaterThanOrEqual(width - 1);
        // Closing gives the space back.
        await panel.getByRole('button', { name: 'Close Citations' }).click();
        await expect(panel).toHaveCount(0);
        const after = await page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().right);
        expect(after).toBeGreaterThanOrEqual(width - 1);
      });
    }
  }

  test('at 1100 the panel overlays from the right edge with a shadow, 8 px clear of the scroll bar', async ({
    page,
  }) => {
    await openMembranes(page, 1100);
    await openTool(page, 'Open citations');
    const panel = page.getByRole('dialog', { name: 'Citations' });
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    const track = await page.evaluate(() => {
      const scroller =
        document.querySelector<HTMLElement>('[data-scope=page][class*=viewport]') ?? document.querySelector('main')!;
      return scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
    });
    expect(box.x + box.width, 'from the right edge, 8 px clear of the scroll bar').toBeCloseTo(track - 8, 0);
    expect(await panel.evaluate((one) => getComputedStyle(one).boxShadow)).not.toBe('none');
    const main = await page.evaluate(() => document.querySelector('main')!.getBoundingClientRect().right);
    expect(main, 'the page keeps its width').toBeGreaterThanOrEqual(1100 - 1);
  });

  test('the edge resizes the panel and the width is remembered', async ({ page }) => {
    await openMembranes(page, 2000);
    await openTool(page, 'Open citations');
    const panel = page.getByRole('dialog', { name: 'Citations' });
    const edge = panel.getByRole('separator');
    const before = (await panel.boundingBox())!.width;
    await edge.focus();
    await page.keyboard.press('ArrowLeft');
    expect((await panel.boundingBox())!.width).toBe(before + 16);
    await openMembranes(page, 2000);
    await openTool(page, 'Open citations');
    expect((await page.getByRole('dialog', { name: 'Citations' }).boundingBox())!.width).toBe(before + 16);
  });
});

test.describe('the Properties chip', () => {
  for (const width of WIDTHS) {
    test(`stays inside the page area and clear of a new tool window at ${width}`, async ({ page }) => {
      await openMembranes(page, width);
      const chip = page.getByRole('button', { name: /^Properties/ });
      await expect(chip).toBeVisible();
      const main = (await page.locator('main').boundingBox())!;
      const box = (await chip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(main.x);
      expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width);
      // Clear of the page's scroll bar, with a gap.
      const contentRight = await page.evaluate(() => {
        let element = document.querySelector('[data-page-title]') as HTMLElement | null;
        while (element && getComputedStyle(element).overflowY !== 'auto') element = element.parentElement;
        return element ? element.getBoundingClientRect().left + element.clientLeft + element.clientWidth : 0;
      });
      expect(box.x + box.width).toBeLessThanOrEqual(contentRight - 8);
      await openTool(page, 'Open citations');
      await expect(page.getByRole('dialog', { name: 'Citations' })).toBeVisible();
      // Docked, the chip moves beside the panel instead of sitting under it. At 1280 there is no room, so it overlays.
      if (width < 1600) return;
      const panelBox = (await page.getByRole('dialog', { name: 'Citations' }).boundingBox())!;
      const moved = (await chip.boundingBox())!;
      expect(moved.x + moved.width).toBeLessThanOrEqual(panelBox.x);
    });
  }
});

test('a tool window wider than a phone-size window stays inside it', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/?fixture=smart');
  await page.getByRole('treeitem', { name: 'Lectures' }).first().click();
  await page.getByRole('treeitem', { name: 'Membranes' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await openTool(page, 'Open citations');
  const box = (await page.getByRole('dialog', { name: 'Citations' }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);
});

test('a long title wraps before the Properties chip', async ({ page }) => {
  await openMembranes(page, 1280);
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Membrane transport, signalling and the fluid mosaic model, part two');
  const chip = (await page.getByRole('button', { name: /^Properties/ }).boundingBox())!;
  const right = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-page-title]')!);
    return Math.max(...[...range.getClientRects()].map((rect) => rect.right));
  });
  expect(right).toBeLessThanOrEqual(chip.x - 4);
});

test.describe('controls line up with the text and fields around them', () => {
  for (const width of WIDTHS) {
    test(`a settings switch lines up with its heading, and its track with the fields at ${width}`, async ({ page }) => {
      VIEWPORTS.wide = { width, height: 900 };
      const screen = (await loadScreens()).find((candidate) => candidate.id === 'recording.settings')!;
      await openScreen(page, screen, { size: 'wide', theme: 'light' });
      const edges = await page.evaluate(() => {
        const heading = document.querySelector('h1')!.getBoundingClientRect();
        const row = [...document.querySelectorAll('main [role=switch]')].find((s) => s.querySelector('span'))!;
        const label = document.createRange();
        label.selectNodeContents(row.querySelector('span')!);
        const track = row.querySelector('span:last-child')!.getBoundingClientRect();
        const select = document.querySelector('main select')!.getBoundingClientRect();
        return {
          heading: heading.left,
          label: label.getBoundingClientRect().left,
          track: track.right,
          select: select.right,
        };
      });
      expect(Math.abs(edges.label - edges.heading)).toBeLessThanOrEqual(1);
      expect(Math.abs(edges.track - edges.select)).toBeLessThanOrEqual(2);
    });
  }

  test('the calculator answer keeps a gap under the entry row', async ({ page }) => {
    await openMembranes(page, 1280);
    await openTool(page, 'Calculator');
    const field = page.getByRole('textbox', { name: 'Expression' });
    await field.fill('2+2');
    await field.press('Enter');
    const gap = await page.evaluate(() => {
      const input = document.querySelector('input[aria-describedby="calc-result"]')!.getBoundingClientRect();
      const answer = document.getElementById('calc-result')!.getBoundingClientRect();
      return answer.top - input.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  test('the shortcuts table starts at the group title', async ({ page }) => {
    VIEWPORTS.wide = { width: 1280, height: 900 };
    const screen = (await loadScreens()).find((candidate) => candidate.id === 'shortcuts.dialog')!;
    await openScreen(page, screen, { size: 'wide', theme: 'light' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const lefts = await dialog.evaluate((root) => {
      const title = root.querySelector('h2:not(:first-of-type), h3')!.getBoundingClientRect().left;
      const cell = root.querySelector('tbody th, tbody td')!;
      const range = document.createRange();
      range.selectNodeContents(cell);
      return { title, cell: range.getBoundingClientRect().left };
    });
    expect(Math.abs(lefts.title - lefts.cell)).toBeLessThanOrEqual(1);
  });
});
