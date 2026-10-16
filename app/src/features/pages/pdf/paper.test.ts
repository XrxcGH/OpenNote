// Page-break placement at each paper size (DEVELOPMENT.md, Phase 6): the lecture page is printed to PDF on every size of
// paper, and the sheets, the PDF, and the page are compared. Layout differs between sizes, so the checks are the rules
// that must hold on any of them.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentText, parseMarkdown } from '../export/markdown';
import type { ExportPage } from '../export/source';
import { PAPER_SIZES, type PaperSizeName } from '../pagination/geometry';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { letters, printPage } from '../testing/run';
import { lecturePage, pngDataUri, type SampleOptions } from '../testing/samples';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

const IMG = { img1: pngDataUri(48, 32, [47, 79, 154]) };
/** Glyphs reach a little past their line box, so text may show this far (in page units) outside the content box. */
const OVERHANG = 4;

interface Case {
  readonly name: string;
  readonly options: SampleOptions;
  /** The page Chromium writes, in points. */
  readonly points: [number, number];
}

const paper = (size: Exclude<PaperSizeName, 'custom'>) => ({ size, ...PAPER_SIZES[size] });

const CASES: Case[] = [
  { name: 'Letter', options: { paper: paper('letter') }, points: [612, 792] },
  { name: 'A4', options: { paper: paper('a4') }, points: [594.96, 841.92] },
  { name: 'A5', options: { paper: paper('a5') }, points: [419.53, 595.28] },
  { name: 'Legal', options: { paper: paper('legal') }, points: [612, 1008] },
  { name: 'Tabloid', options: { paper: paper('tabloid') }, points: [792, 1224] },
  { name: 'Letter landscape', options: { paper: paper('letter'), orientation: 'landscape' }, points: [792, 612] },
  { name: 'A4 landscape', options: { paper: paper('a4'), orientation: 'landscape' }, points: [841.92, 594.96] },
  { name: 'custom 5 by 7 inches', options: { paper: { size: 'custom', width: 480, height: 672 } }, points: [360, 504] },
];

/** The text the page should show, from the model. Table cells are plain text, and the unknown block shows a note. */
function expectedLetters(page: ExportPage): string[] {
  const parts: string[] = [];
  for (const b of page.blocks) {
    if (b.type === 'text') parts.push(documentText(parseMarkdown(b.markdown)));
    else if (b.type === 'table') {
      for (const row of b.rows)
        for (const c of b.columns) parts.push(documentText(parseMarkdown(row.cells[c.id] ?? '')));
    } else if (b.type === 'other' && b.kind !== 'break')
      parts.push('This part of the page needs a newer version of OpenNote.');
  }
  return letters(parts.join(' '));
}

/** Removes `extra` from `all`, both sorted. Returns null if `extra` is not a part of `all`. */
function without(all: readonly string[], extra: readonly string[]): string[] | null {
  const out = [...all];
  for (const c of extra) {
    const at = out.indexOf(c);
    if (at < 0) return null;
    out.splice(at, 1);
  }
  return out;
}

describe.each(CASES)('the lecture page on $name paper', ({ options, points }) => {
  it('keeps every break inside the content box, keeps its text, repeats the table header, and cuts no image', async () => {
    const page = lecturePage(options);
    const { result, sheets } = await printPage(browser, page, {}, IMG);
    const { info, plan } = result;
    const [top, , bottom] = page.view.paper.margins;
    const height = plan.box.height;
    expect(result.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(info.pages).toHaveLength(plan.sheets.length);
    info.pages.forEach((p) => {
      expect(p.width).toBeCloseTo(points[0], 0);
      expect(p.height).toBeCloseTo(points[1], 0);
    });
    sheets.forEach((sheet, i) => {
      expect(letters(info.pages[i].text)).toEqual(letters(sheet.text));
      for (const slice of sheet.slices) {
        expect(slice.top).toBeGreaterThanOrEqual(top - OVERHANG);
        // A picture or table row taller than the content box is clipped. Nothing else may pass the bottom margin.
        if (slice.bottom - slice.top < height - top - bottom)
          expect(slice.bottom).toBeLessThanOrEqual(height - bottom + OVERHANG);
      }
      expect(sheet.slices.at(-1)?.last ?? '').not.toMatch(/^H[1-6]$/);
    });
    const printed = letters(sheets.map((s) => s.text).join(' '));
    const header = letters('Column 1 Column 2 Column 3');
    const continued = sheets.filter((s) => /Row \d+ cell/.test(s.text)).length - 1;
    let rest: string[] | null = without(printed, expectedLetters(page));
    for (let k = 0; k < continued && rest; k += 1) rest = without(rest, header);
    expect(rest).toEqual([]);
    for (const sheet of sheets.filter((s) => /Row \d+ cell/.test(s.text))) {
      expect(sheet.text).toContain('Column 1 Column 2 Column 3');
    }
    expect(info.pages.reduce((n, p) => n + p.images, 0)).toBe(1);
  }, 180_000);
});
