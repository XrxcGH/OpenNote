// PDF golden tests (ADR 0006): sample pages are printed to PDF by the installed Edge, the engine of WebView2, and the
// file is checked against the plan, against the document it was printed from, and against the approved text layer.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentCss, lightTheme } from '../export/style';
import { blessing, readGolden, summarize, writeGolden } from '../testing/golden';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { letters, printPage } from '../testing/run';
import { freeformPage, lecturePage, pngDataUri } from '../testing/samples';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

const IMG = { img1: pngDataUri(48, 32, [47, 79, 154]) };
const FOOTER = { footer: { center: '{title}', right: 'Page {page} of {pages}' } };

describe('a lecture page printed to PDF', () => {
  it('has one PDF page for each sheet, at the sheet size, and a text layer that matches the sheets', async () => {
    const { result, sheets } = await printPage(browser, lecturePage(), FOOTER, IMG);
    const { info, plan, problems } = result;
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(plan.sheets.length).toBeGreaterThanOrEqual(4);
    expect(info.pages).toHaveLength(plan.sheets.length);
    expect(sheets).toHaveLength(plan.sheets.length);
    info.pages.forEach((page, i) => {
      expect(page.width).toBeCloseTo(612, 1);
      expect(page.height).toBeCloseTo(792, 1);
      expect(letters(page.text)).toEqual(letters(sheets[i].text));
      expect(sheets[i].text).toContain(`Page ${i + 1} of ${plan.sheets.length}`);
    });
  }, 120_000);

  it('keeps the structure, the language, the title, and bookmarks of an accessible PDF', async () => {
    const { result } = await printPage(browser, lecturePage(), {}, IMG);
    const { info } = result;
    expect(info.tagged).toBe(true);
    expect(info.lang).toBe('en');
    expect(info.title).toBe('Photosynthesis');
    expect(info.outline).toEqual(expect.arrayContaining(['Photosynthesis', 'Section 1: light reactions', 'The end']));
    expect(info.structure.H1).toBeGreaterThanOrEqual(1);
    expect(info.structure.H2).toBeGreaterThanOrEqual(4);
    expect(info.structure.L).toBeGreaterThanOrEqual(4);
    expect(info.structure.LI).toBeGreaterThanOrEqual(12);
    expect(info.structure.Table).toBe(1);
    expect(info.structure.TH).toBeGreaterThanOrEqual(3);
    expect(info.structure.TD).toBeGreaterThanOrEqual(60);
    expect(info.structure.Figure).toBeGreaterThanOrEqual(1);
    expect(info.figuresWithAlt).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('prints no tags when asked not to', async () => {
    const { result } = await printPage(browser, lecturePage(), {}, IMG, { tagged: false });
    expect(result.info.tagged).toBe(false);
    expect(result.problems.map((p) => p.kind)).not.toContain('untagged');
  }, 120_000);

  it('starts a new sheet at a manual break, repeats the table header, and keeps the image whole', async () => {
    const { result, sheets } = await printPage(browser, lecturePage(), {}, IMG);
    const first = sheets.findIndex((s) => s.text.includes('Section 4: light reactions'));
    expect(first).toBeGreaterThan(0);
    expect(sheets[first].text.startsWith('Section 4: light reactions')).toBe(true);
    const tableSheets = sheets.filter((s) => /Row \d+ cell/.test(s.text));
    expect(tableSheets.length).toBeGreaterThanOrEqual(1);
    for (const s of tableSheets) expect(s.text).toContain('Column 1 Column 2 Column 3');
    expect(result.info.pages.map((p) => p.images)).toEqual(expect.arrayContaining([1]));
    expect(result.info.pages.reduce((n, p) => n + p.images, 0)).toBe(1);
  }, 120_000);

  it('matches the approved text layer for this platform', async () => {
    const { result } = await printPage(browser, lecturePage(), FOOTER, IMG);
    const actual = summarize(result.info);
    const { path, golden } = readGolden('lecture-letter');
    if (blessing()) writeGolden(path, actual);
    else if (golden) expect(actual).toEqual(golden);
    else console.info(`No approved file at ${path}. Run with OPENNOTE_BLESS=1 to write it.`);
  }, 120_000);
});

describe('a freeform page printed to PDF', () => {
  it('keeps ink as vector shapes and draws a stroke across a sheet edge on both sheets', async () => {
    const { result } = await printPage(browser, freeformPage(), {}, IMG);
    const { info } = result;
    expect(info.pages).toHaveLength(2);
    expect(info.pages.map((p) => p.images)).toEqual([1, 1]);
    for (const page of info.pages) expect(page.fills).toBeGreaterThan(0);
    expect(info.pages.every((p) => p.text.length > 0)).toBe(true);
  }, 120_000);

  it('has the same words in the PDF as on the sheets', async () => {
    const { result, sheets } = await printPage(browser, freeformPage(), {}, IMG);
    result.info.pages.forEach((page, i) => expect(letters(page.text)).toEqual(letters(sheets[i].text)));
  }, 120_000);
});

describe('page ranges and headers', () => {
  it('prints only the sheets asked for, numbered as on the page', async () => {
    const all = await printPage(browser, lecturePage(), {}, IMG);
    const total = all.result.plan.total;
    const { result, sheets } = await printPage(browser, lecturePage(), { ...FOOTER, range: '2-3' }, IMG);
    expect(result.info.pages).toHaveLength(2);
    expect(result.plan.total).toBe(total);
    expect(sheets[0].text).toContain(`Page 2 of ${total}`);
    expect(sheets[1].text).toContain(`Page 3 of ${total}`);
    expect(result.info.pages[0].text).toContain(`Page 2 of ${total}`);
  }, 120_000);

  it('prints the stylesheet without borders', () => {
    expect(documentCss(lightTheme())).not.toMatch(/border:/);
  });
});
