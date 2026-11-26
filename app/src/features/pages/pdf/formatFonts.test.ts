// PDF golden test for formatted text (text DESIGN.md 6.6, ADR 0006): a page whose text names a bundled font prints to a
// PDF that lists that font among its embedded fonts, and a page that does not name it does not. Chromium embeds a
// subset of each font it draws, so the check reads the PDF itself, not the document it was printed from.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readExportPage } from '../export/source';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { printPage } from '../testing/run';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

const page = (markdown: string) =>
  readExportPage({ id: 'P', title: 'Fonts', blocks: [{ id: 'b1', order: 'a', type: 'text', data: { markdown } }] });

const MONO = 'Atkinson Hyperlegible Mono';

describe('a formatted page printed to PDF', () => {
  it('lists the bundled font its text names among the embedded fonts', async () => {
    const md = `Plain words and <span data-font="${MONO}">monospaced words</span> and <span data-size="14" data-weight="600">x</span>`;
    const { result } = await printPage(browser, page(md));
    const names = result.info.fonts.filter((f) => f.embedded).map((f) => f.name.replace(/^[A-Z]{6}\+/, ''));
    expect(names.some((name) => /Atkinson/i.test(name))).toBe(true);
  }, 120_000);

  // A machine that has Calibri or Cambria installed draws those, so the test names the stand-ins themselves: the app
  // loads their files for a page whose text names Calibri or Cambria and a machine without them (host/fonts.ts).
  it('lists the bundled stand-in fonts for Calibri and Cambria when text uses them', async () => {
    const md =
      'Plain words and <span data-font="Carlito">calibri words</span> and <span data-font="Caladea">cambria words</span>';
    const { result } = await printPage(browser, page(md));
    const names = result.info.fonts.filter((f) => f.embedded).map((f) => f.name.replace(/^[A-Z]{6}\+/, ''));
    expect(names.some((name) => /Carlito/i.test(name))).toBe(true);
    expect(names.some((name) => /Caladea/i.test(name))).toBe(true);
  }, 120_000);

  it('does not list that font when no text names it', async () => {
    const { result } = await printPage(browser, page('Plain words only, and nothing in monospace.'));
    const names = result.info.fonts.map((f) => f.name);
    expect(names.some((name) => /Atkinson/i.test(name))).toBe(false);
  }, 120_000);
});
