// The calm polish of the shell (docs/BRAND.md sections 4, 8, 11, and 12). Pressed tools survive a Windows contrast
// theme. Group dividers are short. The notebook's color shows in three marks. The evening is plum. The canvas is flat
// for more contrast. Interface text uses the selection color. Focus the app moves shows no ring after a pointer.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen, settle } from '../screens';
import type { ScreenState } from '../screens';

const screens = await loadScreens();
const byId = (id: string): ScreenState => {
  const screen = screens.find((candidate) => candidate.id === id);
  if (!screen) throw new Error(`No screen state ${id}`);
  return screen;
};

async function openPage(page: Page, name = 'Membranes', section = 'Lectures'): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: section }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
}

/** The computed color a CSS value paints, read through a probe. */
function paint(page: Page, value: string, property = 'color'): Promise<string> {
  return page.evaluate(
    ([css, prop]) => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.setProperty(prop, css);
      const result = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return result;
    },
    [value, property],
  );
}

const toolbar = (page: Page, name: string): Locator => page.getByRole('toolbar', { name });

test.describe('pressed tools', () => {
  test('are visible in a contrast theme @forced', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openPage(page);
    await page.getByRole('textbox', { name: 'Text' }).click();
    await page.keyboard.press('Control+b');
    const bold = toolbar(page, 'Home').getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    const highlight = await paint(page, 'Highlight', 'background-color');
    expect(await bold.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(highlight);

    await page.getByRole('tab', { name: 'Draw' }).click();
    const select = toolbar(page, 'Draw').getByRole('button', { name: 'Select and type' });
    await select.click();
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(await select.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(highlight);
  });

  test('keep their icon and gain an outline, not a fill of another weight', async ({ page }) => {
    await openPage(page);
    await page.getByRole('textbox', { name: 'Text' }).click();
    // The formatting tools join the bar when the first key reaches the editor.
    await page.keyboard.press('Control+b');
    const bold = toolbar(page, 'Home').getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    const pressedIcon = await bold.locator('svg').innerHTML();
    const ring = await bold.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(ring).toContain('inset');
    expect(ring).toContain('1px');
    await page.keyboard.press('Control+b');
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    expect(await bold.locator('svg').innerHTML()).toBe(pressedIcon);
    expect(await bold.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
  });
});

test('shows the selected page row with the system highlight in a contrast theme @forced', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openPage(page);
  const row = page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  const highlight = await paint(page, 'Highlight', 'background-color');
  expect(await row.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(highlight);
});

test('draws each group divider 20 px tall, short of the bar', async ({ page }) => {
  await openPage(page);
  const dividers = await toolbar(page, 'Home')
    .locator('[data-group-start]')
    .evaluateAll((slots) =>
      slots.map((slot) => ({
        before: getComputedStyle(slot, '::before').height,
        slot: slot.getBoundingClientRect().height,
        bar: (slot.closest('[role=toolbar]') as HTMLElement).getBoundingClientRect().height,
      })),
    );
  // The bar draws a divider only where one group follows another on the same tab; Toolbar.icons.test.tsx checks the
  // rule on registered groups.
  for (const divider of dividers) {
    expect(divider.before).toBe('20px');
    expect(parseFloat(divider.before)).toBeLessThan(divider.bar);
  }
});

test.describe('the Draw bar', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`keeps the seven pens, Color and Width on the bar at 1,280 by 800 in ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 1280, height: 800 });
      await openPage(page);
      await page.getByRole('tab', { name: 'Draw' }).click();
      const draw = toolbar(page, 'Draw');
      await expect(draw.locator('[data-ink-slot]')).toHaveCount(7);
      for (const selector of ['[data-ink-slot]', '[data-ink-color]', '[data-ink-width]']) {
        for (const handle of await draw.locator(selector).all()) await expect(handle).toBeVisible();
      }
    });
  }

  test('with touch sizes at 1,280 by 800, keeps the tools and reaches every pen from More', async ({ page }) => {
    await page.addInitScript(() => {
      window.__OPENNOTE_BOOT__ = { settings: { appearance: { density: 'touch' } }, bootVersion: 1 } as never;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openPage(page);
    await expect(page.locator('html')).toHaveAttribute('data-density', 'touch');
    await page.getByRole('tab', { name: 'Draw' }).click();
    const draw = toolbar(page, 'Draw');
    await expect(draw.getByRole('button', { name: 'Select and type' })).toBeVisible();
    const more = draw.getByRole('button', { name: 'More commands' });
    await more.click();
    // At touch sizes the seven pens fold into More, behind one Choose pen item, with Pen color and Pen width.
    for (const name of ['Choose pen', 'Pen color', 'Pen width'])
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  });

  test('keeps the five tools on the bar at 1,024 by 768 and reaches the pens from More', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPage(page);
    await page.getByRole('tab', { name: 'Draw' }).click();
    const draw = toolbar(page, 'Draw');
    await expect(draw.getByRole('button', { name: 'Select and type' })).toBeVisible();
    await expect(draw.getByRole('button', { name: 'Lasso select' })).toBeVisible();
    await draw.getByRole('button', { name: 'More commands' }).click();
    await expect(page.getByRole('menuitem', { name: /^Pen/ }).first()).toBeVisible();
  });
});

/** The tools on one tab of the bar: its visible buttons, apart from the More menu. */
async function barCount(page: Page, tab: string): Promise<number> {
  await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(300);
  return toolbar(page, tab)
    .getByRole('button')
    .evaluateAll(
      (buttons) =>
        buttons.filter(
          (b) => (b as HTMLElement).offsetParent !== null && b.getAttribute('aria-label') !== 'More commands',
        ).length,
    );
}

// The tools each tab showed at 1,280 by 800 on beta before the bar was polished (the merge base of this lane). The bar
// may fold a few into More to make room for icons, but not many.
const BETA_COUNTS = { homePage: 10, homeEmpty: 10, insertEmpty: 5, drawPage: 8 };

test.describe('tool counts at 1,280 by 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Home with a page open loses at most 1 tool against beta, and Draw at most 1', async ({ page }) => {
    await openPage(page);
    const home = await barCount(page, 'Home');
    if (process.env.OPENNOTE_COUNTS) console.log('COUNTS homePage', home, 'drawPage', await barCount(page, 'Draw'));
    expect(home).toBeGreaterThanOrEqual(BETA_COUNTS.homePage - 1);
    expect(await barCount(page, 'Draw')).toBeGreaterThanOrEqual(BETA_COUNTS.drawPage - 1);
  });

  test('Home and Insert with no page open lose at most 2 tools against beta', async ({ page }) => {
    await openScreen(page, byId('workspace.empty'), { size: 'wide', theme: 'light' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const home = await barCount(page, 'Home');
    const insert = await barCount(page, 'Insert');
    if (process.env.OPENNOTE_COUNTS) console.log('COUNTS homeEmpty', home, 'insertEmpty', insert);
    expect(home).toBeGreaterThanOrEqual(BETA_COUNTS.homeEmpty - 2);
    expect(insert).toBeGreaterThanOrEqual(BETA_COUNTS.insertEmpty - 2);
  });
});

/** Sets a notebook's color from its menu in the tree. */
async function colorNotebook(page: Page, name: string, color: string): Promise<void> {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Color' }).click();
  await page.getByRole('menuitemradio', { name: color }).click();
}

test.describe('the notebook color', () => {
  test('shows as the breadcrumb dot, the active tab edge and the title rule, and nowhere in the page list', async ({
    page,
  }) => {
    await page.goto('/');
    await colorNotebook(page, 'Biology 101', 'Plum');
    await colorNotebook(page, 'Work', 'No color');
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Labs' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Photosynthesis lab' })).toBeVisible();
    const plum = await paint(page, 'var(--ink-plum)');

    // The title rule and the breadcrumb dot follow the notebook.
    await expect(page.locator('[data-notebook-mark="title-rule"]')).toHaveCount(1);
    await expect(page.locator('[data-notebook-mark="breadcrumb"]')).toHaveCount(1);
    const rule = await page
      .locator('[data-notebook-mark="title-rule"]')
      .evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    expect(rule).toBe(await paint(page, 'var(--ink-plum)', 'background-color'));

    // Nothing in the page list carries a notebook mark or paints the notebook's pen.
    const list = page.getByRole('tree', { name: 'Pages' });
    await expect(list.locator('[data-notebook-mark]')).toHaveCount(0);
    const painted = await list.evaluate((root, pen) => {
      const all = [root, ...root.querySelectorAll('*')];
      return all.filter((element) => {
        const style = getComputedStyle(element);
        return [style.color, style.backgroundColor, style.borderTopColor].includes(pen);
      }).length;
    }, plum);
    expect(painted).toBe(0);

    // With a second tab, the active tab takes the edge in its own notebook's color.
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).focus();
    await page.keyboard.press('Control+Enter');
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Work' }).click();
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Meetings' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Weekly sync' }).click();
    const tabs = page.getByRole('tablist', { name: 'Open pages' });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await tabs.getByRole('tab').first().click();
    const tab = tabs.locator('[data-notebook-mark="tab"]');
    await expect(tab).toHaveCount(1);
    expect(await tab.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(plum);
    const marks = await page
      .locator('[data-notebook-mark]')
      .evaluateAll((all) => all.map((element) => (element as HTMLElement).dataset.notebookMark));
    expect(marks.sort()).toEqual(['breadcrumb', 'tab', 'title-rule']);

    // The tab of the notebook with no color shows no edge.
    await tabs.getByRole('tab').last().click();
    await expect(tabs.locator('[data-notebook-mark="tab"]')).toHaveCount(0);
    await expect(page.locator('[data-notebook-mark="breadcrumb"]')).toHaveCount(0);
    const clay = await paint(page, 'var(--color-accent-clay)', 'background-color');
    const clayRule = await page
      .locator('[data-page-title], article h1')
      .first()
      .evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    expect(clayRule).toBe(clay);
  });

  test('the title rule uses the light pen with paper pages in the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      window.__OPENNOTE_BOOT__ = {
        settings: { appearance: { theme: 'dark', pageColor: 'paper' } },
        bootVersion: 1,
      } as never;
    });
    await page.goto('/');
    await colorNotebook(page, 'Biology 101', 'Plum');
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
    const rule = page.locator('[data-notebook-mark="title-rule"]');
    await expect(rule).toHaveCount(1);
    const color = await rule.evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
    // The light theme's Plum, #6A4A9C.
    expect(color).toBe('rgb(106, 74, 156)');
  });
});

/** The red, green, and blue of one pixel of a screenshot. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, shot.toString('base64'));
}

test('paints the evening horizon plum, not maroon', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openScreen(page, byId('workspace.empty'), { size: 'wide', theme: 'dark' });
  await settle(page);
  const [r, g, b] = await pixel(page, 720, 895);
  // Plum has blue at or above green and a red only a little above its blue. The old maroon had red 20 above blue.
  expect(b).toBeGreaterThanOrEqual(g);
  expect(r - b).toBeLessThanOrEqual(8);
});

test.describe('more contrast', () => {
  test('flattens the canvas and hides the stars', async ({ page }) => {
    await openScreen(page, byId('workspace.empty'), { size: 'wide', theme: 'dark' });
    const canvas = page.locator('[data-region="page"]').first();
    const layers = () => canvas.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(await layers()).toContain('gradient');
    await page.emulateMedia({ contrast: 'more' } as never);
    await expect.poll(layers).toBe('none');
    const stars = await page
      .locator('svg[viewBox="0 0 1280 160"]')
      .evaluateAll((all) => all.filter((element) => getComputedStyle(element).display !== 'none').length);
    expect(stars).toBe(0);
  });
});

test('selects interface text with the selection color', async ({ page }) => {
  await openPage(page);
  const title = page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' });
  await title.dblclick();
  await page.keyboard.press('Escape');
  const seen = await page.evaluate(() => {
    const row = document.querySelector('[role="tree"][aria-label="Pages"] [role="treeitem"]') as HTMLElement;
    const text = (row.querySelector('span') ?? row) as HTMLElement;
    return getComputedStyle(text, '::selection').backgroundColor;
  });
  expect(seen).toBe(await paint(page, 'var(--color-selection-highlight)', 'background-color'));
});

test.describe('focus the app moves', () => {
  const outline = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).outlineStyle);

  test('shows no ring before any input, and brings it back with the next arrow key', async ({ page }) => {
    await openScreen(page, byId('settings.appearance'), { size: 'wide', theme: 'light' });
    const heading = page.locator('h1:focus, h2:focus').first();
    await expect(heading).toBeFocused();
    expect(await outline(heading)).toBe('none');
    await page.keyboard.press('ArrowDown');
    expect(await outline(page.locator(':focus'))).not.toBe('none');
  });

  test('setup opens on Get started with no ring, and an arrow key shows it', async ({ page }) => {
    await openScreen(page, byId('setup.welcome'), { size: 'wide', theme: 'light' });
    const start = page.getByRole('button', { name: 'Get started' });
    await expect(start).toBeFocused();
    expect(await outline(start)).toBe('none');
    await page.keyboard.press('ArrowDown');
    await expect(start).toBeFocused();
    expect(await outline(start)).not.toBe('none');
  });

  test('a dialog opened by a script click, with no pointer or key before it, shows no ring until Tab', async ({
    page,
  }) => {
    // The page opens on a page through the boot payload, so no click or key reaches it before the dialog.
    await page.addInitScript(() => {
      window.__OPENNOTE_BOOT__ = {
        state: {
          location: { view: 'workspace', notebookId: 'n-biology', sectionId: 's-lectures', pageId: 'p-mitosis' },
        },
        bootVersion: 1,
      } as never;
    });
    await page.goto('/');
    await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
    // Every step here is HTMLElement.click() or a read from the page.
    const click = (pattern: string) =>
      page.evaluate((source) => {
        const regex = new RegExp(source);
        const items = [...document.querySelectorAll<HTMLElement>('[role=toolbar] button, [role=menuitem]')];
        const named = (node: Element) => node.getAttribute('aria-label') ?? node.textContent ?? '';
        const found = items.find((node) => regex.test(named(node)));
        found?.click();
        return Boolean(found);
      }, pattern);
    if (!(await click('^Import'))) {
      expect(await click('^More commands$')).toBe(true);
      await page.waitForTimeout(300);
      expect(await click('^Import')).toBe(true);
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const focused = dialog.locator(':focus').first();
    await expect(focused).toBeVisible();
    expect(await outline(focused)).toBe('none');
    await page.keyboard.press('Tab');
    expect(await outline(page.locator(':focus'))).not.toBe('none');
  });
});

test.describe('focus the app moves, by pointer and by key', () => {
  const outline = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).outlineStyle);

  test('clicking Appearance in Settings leaves the heading with no ring', async ({ page }) => {
    await openPage(page);
    await page.keyboard.press('Control+Comma');
    const sections = page.getByRole('navigation', { name: 'Settings sections' });
    await sections.waitFor();
    await sections.getByRole('link', { name: 'Appearance', exact: true }).click();
    const heading = page.getByRole('heading', { level: 1, name: 'Appearance', exact: true });
    await expect(heading).toBeVisible();
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await outline(page.locator(':focus'))).toBe('none');
  });

  test('choosing Appearance in Settings with the keyboard shows the ring', async ({ page }) => {
    await openPage(page);
    await page.keyboard.press('Control+Comma');
    const sections = page.getByRole('navigation', { name: 'Settings sections' });
    await sections.waitFor();
    const link = sections.getByRole('link', { name: 'Appearance', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Appearance', exact: true })).toBeVisible();
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await outline(page.locator(':focus'))).not.toBe('none');
  });

  test('opening Import with a mouse click leaves the dialog with no ring', async ({ page }) => {
    await openPage(page);
    await page.getByRole('tab', { name: 'Home' }).click();
    const bar = toolbar(page, 'Home');
    const direct = bar.getByRole('button', { name: /^Import/ });
    if (await direct.count()) await direct.first().click();
    else {
      await bar.getByRole('button', { name: 'More commands' }).click();
      await page
        .getByRole('menuitem', { name: /^Import/ })
        .first()
        .click();
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const focused = dialog.locator(':focus').first();
    await expect(focused).toBeVisible();
    expect(await outline(focused)).toBe('none');
  });

  test('opening Import from the palette with Enter shows the ring', async ({ page }) => {
    await openPage(page);
    await page.locator('[contenteditable=true] p').first().click();
    await page.keyboard.press('Control+k');
    await page.getByPlaceholder('Type a command or a page name').fill('Import');
    await page
      .getByRole('option', { name: /^Import/ })
      .first()
      .waitFor();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const focused = dialog.locator(':focus').first();
    await expect(focused).toBeVisible();
    // The palette's Enter is a key, so the dialog's focus carries no pointer mark.
    await expect(focused).not.toHaveAttribute('data-focus-origin', 'pointer');
    await expect(page.locator('[data-focus-origin]')).toHaveCount(0);
  });

  test('clicking Get started moves focus on with no ring', async ({ page }) => {
    await openScreen(page, byId('setup.welcome'), { size: 'wide', theme: 'light' });
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await outline(page.locator(':focus'))).toBe('none');
  });

  test('pressing Enter on Get started moves focus on with the ring', async ({ page }) => {
    await openScreen(page, byId('setup.welcome'), { size: 'wide', theme: 'light' });
    await expect(page.getByRole('button', { name: 'Get started' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
    await expect(page.locator(':focus')).toHaveCount(1);
    expect(await outline(page.locator(':focus'))).not.toBe('none');
  });

  test('a keyboard choice keeps the ring on the focused heading', async ({ page }) => {
    await openScreen(page, byId('settings.appearance'), { size: 'wide', theme: 'light' });
    await page.keyboard.press('ArrowDown');
    expect(await outline(page.locator(':focus'))).not.toBe('none');
  });
});
