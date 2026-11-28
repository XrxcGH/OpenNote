// Typing writes nothing the page already shows (docs/perf/phase-4.md). The browser takes a value written again as a
// change. It restyles the element and asks for a frame. Work that does so between two keys makes the next key wait a
// whole frame. That kept the nightly perf-typing-gate over its 16 ms budget.
//
// Here the typing benchmark's conditions type words at a steady pace. The checks:
// - The app writes no `hidden`, attribute, boolean attribute, or style property with the value it has.
// - Between keys, no attribute is written with its own value, by any code.
// - A smart table's recalculation leaves its toolbar alone when its results did not change.
// - A key typed in a table cell draws neither the cell format bar nor the formula bar's name box again.
// - A table whose features load while the person types in a cell writes nothing back as each feature joins.
// - The code studio draws a problem once, though its checks publish it after each key.
// - A key at the end of a long code line scrolls the editor once, not twice.

import type { Page } from '@playwright/test';
import { CONDITIONS, openFixture } from '../../perf/typing/conditions';
import { expect, test } from '../fixtures';

declare global {
  interface Window {
    __sameWrites?: string[];
    __inputsDrawn?: string[];
    __tableInputsDrawn?: string[];
  }
}

/** Records each write by the app of a value an element already has, with where it came from. */
function watchWrites(): void {
  const found: string[] = [];
  window.__sameWrites = found;
  // Only the app's own code counts: its scripts load from /assets/.
  const where = () => (new Error().stack ?? '').split('\n').slice(3, 6).join(' <');
  const note = (what: string) => {
    const stack = where();
    if (stack.includes('/assets/')) found.push(`${what} ${stack}`);
  };
  const hidden = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden')!;
  Object.defineProperty(HTMLElement.prototype, 'hidden', {
    ...hidden,
    set(this: HTMLElement, value: unknown) {
      if (hidden.get!.call(this) === Boolean(value)) note(`hidden=${String(value)}`);
      hidden.set!.call(this, value);
    },
  });
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
    if (this.getAttribute(name) === String(value)) note(`${name}="${value}"`);
    setAttribute.call(this, name, value);
  };
  const toggleAttribute = Element.prototype.toggleAttribute;
  Element.prototype.toggleAttribute = function (this: Element, name: string, force?: boolean) {
    if (force !== undefined && this.hasAttribute(name) === force) note(`${name} ${String(force)}`);
    return toggleAttribute.call(this, name, force);
  };
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name, value, priority) {
    if (this.getPropertyValue(name) === String(value ?? '')) note(`${name}: ${value}`);
    setProperty.call(this, name, value, priority);
  };
}

/**
 * Records, between keys, each attribute written with its own value by any code, and each input React drew. Records
 * too each input of a table's toolbar drawn at any time, the key's own frame included.
 */
function watchBetweenKeys(): void {
  const found = window.__sameWrites!;
  const inputs: string[] = [];
  const tableInputs: string[] = [];
  window.__inputsDrawn = inputs;
  window.__tableInputsDrawn = tableInputs;
  let lastKey = performance.now();
  window.addEventListener('keydown', () => (lastKey = performance.now()), { capture: true });
  new MutationObserver((records) => {
    const betweenKeys = performance.now() - lastKey >= 40;
    for (const record of records) {
      const target = record.target as Element;
      // CodeMirror draws its own editor; the studio's checks below cover what the app sends it.
      if (target.closest('.cm-editor')) continue;
      // React writes an input's name and type each time it draws the input, so those say it was drawn.
      if (target instanceof HTMLInputElement && (record.attributeName === 'name' || record.attributeName === 'type')) {
        const name = target.getAttribute('aria-label') ?? target.className;
        if (target.closest('[data-formula-bar], [role="toolbar"][aria-label="Cell format"]')) tableInputs.push(name);
        if (betweenKeys) inputs.push(name);
        continue;
      }
      if (!betweenKeys) continue;
      if (record.oldValue === target.getAttribute(record.attributeName!))
        found.push(`between keys: ${record.attributeName} on ${target.tagName.toLowerCase()}.${target.className}`);
    }
  }).observe(document, { attributes: true, attributeOldValue: true, subtree: true });
}

const TEXT = 'the quick brown fox ';

async function typeSteadily(page: Page, text: string): Promise<void> {
  for (const character of text) {
    await page.keyboard.press(character === ' ' ? 'Space' : character);
    // Longer than the smart table's recalculation (120 ms) and the code checks (50 ms) wait after a key.
    await page.waitForTimeout(160);
  }
}

async function prepared(page: Page, id: string): Promise<void> {
  const condition = CONDITIONS.find((one) => one.id === id);
  if (!condition) throw new Error(`No typing condition ${id}.`);
  await openFixture(page, condition.fixture);
  await condition.prepare(page);
}

test.describe('typing writes nothing the page shows already', () => {
  for (const id of ['flat.end', 'callout', 'table', 'studio']) {
    test(`in the ${id} condition`, async ({ page }) => {
      test.setTimeout(120_000);
      await prepared(page, id);
      // A new table's toolbar loads its cell format bar and formula bar after the cell has the caret. Their first
      // drawing is not a key's work: the watch starts once they show.
      if (id === 'table') {
        await page.getByRole('toolbar', { name: 'Cell format' }).waitFor();
        await page.getByLabel('Name box').waitFor();
      }
      await page.evaluate(watchWrites);
      await page.evaluate(watchBetweenKeys);
      await typeSteadily(page, TEXT);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__sameWrites)).toEqual([]);
      // A smart table calculates again after each key; results that did not change draw nothing, its toolbar's
      // Name box included.
      if (id === 'table') expect(await page.evaluate(() => window.__inputsDrawn)).not.toContain('Name box');
      // The table draws its toolbar again on each key. A key typed in a cell leaves what the cell format bar and
      // the name box show. So they draw nothing again, in the key's own frame too.
      if (id === 'table') expect(await page.evaluate(() => window.__tableInputsDrawn)).toEqual([]);
    });
  }

  test('in a table whose features load while the person types in it', async ({ page }) => {
    // Each of a table's features loads after the table shows and adds a plugin to its editor, which rebuilds every
    // plugin's view. On a slow runner they land while the person types. Their code is held until the first keys are
    // typed, so they land between keys here every time.
    test.setTimeout(120_000);
    const condition = CONDITIONS.find((one) => one.id === 'table')!;
    await openFixture(page, condition.fixture);
    let release = () => {};
    const typed = new Promise<void>((resolve) => (release = resolve));
    const held: string[] = [];
    await page.route(/\/assets\/(attach|plugin)-[^/]*\.js$/, async (route) => {
      held.push(route.request().url());
      await typed;
      await route.continue();
    });
    await condition.prepare(page);
    await page.evaluate(watchWrites);
    await page.evaluate(watchBetweenKeys);
    await typeSteadily(page, 'the ');
    expect(held.length, 'No feature of the table was held back').toBeGreaterThan(0);
    release();
    // The features joined the editor: the spreadsheet keys mark its grid.
    await expect(page.locator('table[role="grid"]')).toBeAttached();
    await typeSteadily(page, 'quick brown fox ');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__sameWrites)).toEqual([]);
  });

  test('a problem the code checks publish again is not drawn again', async ({ page }) => {
    test.setTimeout(120_000);
    await prepared(page, 'studio');
    const marker = page.getByRole('dialog', { name: 'Code studio' }).locator('.cm-gutter-lint .cm-gutterElement > *');
    await typeSteadily(page, 'the quick ');
    await expect(marker).toHaveCount(1);
    const first = await marker.elementHandle();
    await typeSteadily(page, 'brown fox ');
    await page.waitForTimeout(300);
    // The same marker element: the gutter was not drawn again after each key.
    expect(await first!.evaluate((element) => element.isConnected)).toBe(true);
  });

  test('a key at the end of a long code line scrolls the editor once', async ({ page }) => {
    test.setTimeout(120_000);
    await prepared(page, 'studio');
    await page.keyboard.insertText(TEXT.repeat(6));
    await page.waitForTimeout(300);
    const scroller = page.getByRole('dialog', { name: 'Code studio' }).locator('.cm-scroller');
    await scroller.evaluate((element) => {
      (window as unknown as { __scrolls: number }).__scrolls = 0;
      element.addEventListener('scroll', () => (window as unknown as { __scrolls: number }).__scrolls++);
    });
    const keys = 'jumps over a lazy dog';
    await typeSteadily(page, keys);
    const scrolls = await page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls);
    // The browser shows the caret with the same margin the editor keeps, so the editor need not scroll it again.
    expect(scrolls).toBeGreaterThan(0);
    expect(scrolls).toBeLessThanOrEqual(keys.length);
  });
});
