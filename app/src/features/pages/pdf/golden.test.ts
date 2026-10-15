// PDF golden tests (ADR 0006): sample pages are printed to PDF by the installed Edge, the engine of WebView2, and the
// file is checked against the plan, against the document it was printed from, and against the approved text layer.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentCss, lightTheme } from '../export/style';
import { blessing, readGolden, summarize, summarizeVector, writeGolden } from '../testing/golden';
import type { VectorGolden } from '../testing/golden';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { letters, printPage } from '../testing/run';
import { chartPage, freeformPage, graphPage, lecturePage, mathPage, pngDataUri } from '../testing/samples';

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

describe('math, graphs, and charts printed to PDF', () => {
  it('prints display and inline math as text and shapes, with no picture', async () => {
    const { result } = await printPage(browser, mathPage(), {}, IMG);
    const { info } = result;
    expect(result.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(info.pages).toHaveLength(1);
    expect(info.pages[0].images).toBe(0);
    expect(info.pages[0].text).toContain('Equations');
    // MathML letters come out as mathematical italic code points: pi is U+1D70B.
    expect(info.pages[0].text).toContain(String.fromCodePoint(0x1d70b));
    expect(info.pages[0].text).toContain('∑');
    expect(info.pages[0].text).not.toContain('\\frac');
    expect(info.tagged).toBe(true);
  }, 120_000);

  it('prints a graph block as a vector drawing with its curves, axes, and labels', async () => {
    const { result } = await printPage(browser, graphPage(), {}, IMG);
    const { info } = result;
    expect(result.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(info.pages).toHaveLength(1);
    const first = info.pages[0];
    expect(first.images).toBe(0);
    // Two curves, the grid, and the axes are strokes. The tick labels are text of the drawing.
    expect(first.strokes).toBeGreaterThanOrEqual(4);
    expect(first.text).toContain('Waves');
    expect(first.text).toContain('10');
    expect(first.text).toContain('-8');
    expect(first.text).not.toContain('sin(x)');
    expect(info.structure.Figure).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('prints the charts of a smart table as vector drawings after the table', async () => {
    const { result } = await printPage(browser, chartPage(), {}, IMG);
    const { info } = result;
    expect(result.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(info.pages.every((p) => p.images === 0)).toBe(true);
    const text = info.pages.map((p) => p.text).join('\n');
    expect(text).toContain('Sales');
    expect(text).toContain('After the charts');
    expect(info.pages.reduce((n, p) => n + p.fills + p.strokes, 0)).toBeGreaterThan(20);
    expect(info.structure.Figure).toBeGreaterThanOrEqual(2);
    expect(info.structure.Table).toBe(1);
  }, 120_000);

  it.each([
    ['equations-letter', mathPage],
    ['graph-letter', graphPage],
    ['chart-letter', chartPage],
  ] as const)(
    'matches the approved vector summary of %s for this platform',
    async (name, make) => {
      const { result } = await printPage(browser, make(), {}, IMG);
      const actual = summarizeVector(result.info);
      const { path, golden } = readGolden<VectorGolden>(name);
      if (blessing()) writeGolden(path, actual);
      else if (golden) expect(actual).toEqual(golden);
      else console.info(`No approved file at ${path}. Run with OPENNOTE_BLESS=1 to write it.`);
    },
    120_000,
  );
});
