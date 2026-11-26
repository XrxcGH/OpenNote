// The code editor in the running app (code:L01, DESIGN 5.3 and 5.3.1). The studio window arrives in B12, so a test
// hook mounts an editor on top of the app: typing, folding, several carets, find, and replace, leaving with the
// keyboard, touch caret placement, and the Ctrl+Tab rules with two page tabs open.
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

interface Mount {
  language: string;
  text: string;
  suggest?: { when: string; then: string };
}

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function mountEditor(page: Page, options: Mount): Promise<void> {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
  );
  await page.evaluate(
    (mount) => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorMount(mount),
    options,
  );
  await expect(page.locator('[data-testid="code-editor-host"] .cm-content')).toBeVisible();
}

const text = (page: Page) =>
  page.evaluate(() => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorText() as string);
const head = (page: Page) =>
  page.evaluate(() => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorHead() as number);
const content = (page: Page) => page.locator('[data-testid="code-editor-host"] .cm-content');

async function openTwoTabs(page: Page): Promise<void> {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Labs' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('tablist', { name: 'Open pages' }).getByRole('tab')).toHaveCount(2);
}

/** The index of the selected page tab. Both tabs may show the same page, so the index tells them apart. */
const selectedTab = (page: Page) =>
  page
    .getByRole('tablist', { name: 'Open pages' })
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Notebooks' })).toBeVisible();
});

test('types, folds, edits with several carets, and finds and replaces', async ({ page }) => {
  await mountEditor(page, { language: 'python', text: 'def f(x):\n    return x\n\na = 1\na = 2' });
  await content(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nprint(a)');
  expect(await text(page)).toBe('def f(x):\n    return x\n\na = 1\na = 2\nprint(a)');

  await page.locator('[data-testid="code-editor-host"] .cm-foldGutter span[title="Fold line"]').first().click();
  await expect(page.locator('[data-testid="code-editor-host"] .cm-foldPlaceholder')).toBeVisible();
  await page.locator('[data-testid="code-editor-host"] .cm-foldPlaceholder').click();

  // Ctrl+D twice on the first `a` selects both assignments' names; typing replaces them together.
  await content(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+d');
  await page.keyboard.type('b');
  expect(await text(page)).toBe('def f(x):\n    return x\n\nb = 1\nb = 2\nprint(a)');

  await page.keyboard.press('Control+h');
  const panel = page.locator('[data-testid="code-editor-host"] .cm-search');
  await panel.locator('input[name="search"]').fill('b =');
  await panel.locator('input[name="replace"]').fill('c =');
  await panel.locator('button[name="replaceAll"]').click();
  expect(await text(page)).toBe('def f(x):\n    return x\n\nc = 1\nc = 2\nprint(a)');
});

test('leaves the editor with Escape, then Tab, and Tab indents otherwise', async ({ page }) => {
  await mountEditor(page, { language: 'python', text: 'x' });
  await content(page).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  expect(await text(page)).toBe('    x');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect(await text(page)).toBe('    x');
  const inside = await page.evaluate(() =>
    Boolean(document.querySelector('[data-testid="code-editor-host"]')?.contains(document.activeElement)),
  );
  expect(inside).toBe(false);
});

test('Ctrl+Tab accepts a suggestion and keeps the page tab; Ctrl+Shift+Tab goes to the previous tab', async ({
  page,
}) => {
  await openTwoTabs(page);
  const before = await selectedTab(page);
  await mountEditor(page, { language: 'python', text: '', suggest: { when: 'pri', then: 'nt(total)' } });
  await content(page).click();
  await page.keyboard.type('pri');
  await expect(page.locator('[data-testid="code-editor-host"] .cm-ghost-text')).toHaveText('nt(total)');
  await page.keyboard.press('Control+Tab');
  expect(await text(page)).toBe('print(total)');
  expect(await selectedTab(page)).toBe(before);

  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  expect(await text(page)).toBe('    print(total)');
  expect(await selectedTab(page)).toBe(before);

  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(() => selectedTab(page)).not.toBe(before);
});

test.describe('touch and pen', () => {
  test.use({ hasTouch: true });

  test('a tap places the caret, and a touch or pen tap on Accept inserts the suggestion', async ({ page }) => {
    await mountEditor(page, {
      language: 'python',
      text: 'first line\nsecond line',
      suggest: { when: 'pri', then: 'nt()' },
    });
    const line = page.locator('[data-testid="code-editor-host"] .cm-line').nth(1);
    const box = await line.boundingBox();
    if (!box) throw new Error('No second line');
    await page.touchscreen.tap(box.x + 2, box.y + box.height / 2);
    expect(await head(page)).toBeGreaterThanOrEqual(11);

    await page.keyboard.press('End');
    await page.keyboard.type(' pri');
    const accept = page.locator('[data-testid="code-editor-host"] .cm-ghost-accept');
    await expect(accept).toBeVisible();
    const target = await accept.boundingBox();
    if (!target) throw new Error('No Accept button');
    await page.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
    expect(await text(page)).toBe('first line\nsecond line print()');

    // A pen: the browser reports pointerType "pen"; the button takes the press without moving focus.
    await page.keyboard.type('\npri');
    await expect(accept).toBeVisible();
    await accept.evaluate((button) => {
      const init = { bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 7, isPrimary: true };
      button.dispatchEvent(new PointerEvent('pointerdown', init));
      button.dispatchEvent(new PointerEvent('pointerup', init));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(await text(page)).toBe('first line\nsecond line print()\nprint()');
  });
});
