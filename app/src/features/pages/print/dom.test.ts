// Measuring and slicing text in a browser. Each page goes through `preparePrint` in Edge, and the test reads the print
// document it shows, or the breaks it planned. Layout comes from the bundled fonts, so it is the same on every machine.

import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExportPage } from '../export/source';
import { pageOf, textBlock } from '../testing/build';
import { bundledFontFaces, closeBrowser, edgeSurface, openBrowser } from '../testing/edgeSurface';
import { pngDataUri } from '../testing/samples';
import type { PrepareResult } from './prepare';

let browser: Browser;
let faces: string;
beforeAll(async () => {
  browser = await openBrowser();
  faces = bundledFontFaces();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

/** Prepares the page, shows its print document, and reads it with `read`, which runs in the browser. */
async function printed<T>(
  page: ExportPage,
  read: () => T,
  assetUrls: Record<string, string> = {},
): Promise<{ result: PrepareResult; value: T }> {
  const surface = await edgeSurface(browser, faces);
  try {
    const result = await surface.prepare({ page, assetUrls });
    return { result, value: await surface.page.evaluate(read) };
  } finally {
    await surface.dispose();
  }
}

/** The text of each list item on the sheets, and how many task boxes each holds. */
function listItems(): { text: string; boxes: number; task: boolean }[] {
  return Array.from(document.querySelectorAll('section.sheet li'), (li) => ({
    text: (li.textContent ?? '').trim(),
    boxes: li.querySelectorAll(':scope > .box').length,
    task: li.classList.contains('task'),
  }));
}

const lines = (n: number, line: (i: number) => string): string =>
  Array.from({ length: n }, (_, i) => line(i)).join('\n');

describe('slicing a list across sheets', () => {
  it('leaves no empty item at the end of a sheet', async () => {
    const page = pageOf([textBlock(lines(90, (i) => `- Item ${i + 1}`))]);
    const { result, value } = await printed(page, listItems);
    expect(result.sheets).toBeGreaterThan(1);
    expect(value.map((li) => li.text)).toEqual(Array.from({ length: 90 }, (_, i) => `Item ${i + 1}`));
  }, 120_000);

  it('keeps one box with each task, on the sheet where the task is', async () => {
    const page = pageOf([textBlock(lines(90, (i) => `- [${i % 3 === 0 ? 'x' : ' '}] Task ${i + 1}`))]);
    const { result, value } = await printed(page, listItems);
    expect(result.sheets).toBeGreaterThan(1);
    expect(value).toHaveLength(90);
    expect(value.every((li) => li.task && li.boxes === 1 && li.text !== '')).toBe(true);
  }, 120_000);
});

describe('measuring lines', () => {
  it('counts raised and lowered text as part of its line, so a short paragraph never splits', async () => {
    // Paragraphs of one to three lines, with a superscript or subscript in every word. A phantom line for each would
    // let the paginator split them, and cut a line in two. Their lengths vary, so the sheet edges cut them anywhere.
    const tag = (n: number) => (n % 2 ? 'sup' : 'sub');
    const count = (i: number) => 6 + ((i * 7) % 29);
    const words = (i: number) => Array.from({ length: count(i) }, (_, w) => `w${w}<${tag(i + w)}>${w}</${tag(i + w)}>`);
    const page = pageOf(Array.from({ length: 70 }, (_, i) => textBlock(words(i).join(' '))));
    const { result } = await printed(page, () => null);
    expect(result.sheets).toBeGreaterThan(2);
    expect(result.breaks.filter((b) => b.pos.kind === 'line')).toEqual([]);
  }, 120_000);

  it('makes a line with a tall picture as tall as the picture, so no sheet edge cuts the picture', async () => {
    const paragraph = (i: number) => textBlock(`Intro ${i} ![A tall picture](asset:tall) and more text after it.`);
    // One to four lines of filler before each picture, joined by hard breaks, so the pictures meet the sheet edges at
    // different places.
    const filler = (i: number) => textBlock(lines(1 + (i % 4), (k) => `Filler ${k}`).replaceAll('\n', '\\\n'));
    const page = pageOf(Array.from({ length: 12 }, (_, i) => [filler(i), paragraph(i)]).flat(), {
      assets: { tall: { file: 'tall.png', mime: 'image/png', name: 'tall.png', width: 40, height: 400 } },
    });
    const { result, value } = await printed(
      page,
      () =>
        Array.from(document.querySelectorAll('section.sheet img'), (img) => {
          const sheet = (img.closest('section.sheet') as HTMLElement).getBoundingClientRect();
          const r = img.getBoundingClientRect();
          return { top: r.top - sheet.top, bottom: r.bottom - sheet.top };
        }),
      { tall: pngDataUri(40, 400, [47, 79, 154]) },
    );
    expect(result.sheets).toBeGreaterThan(2);
    expect(value).toHaveLength(12);
    for (const img of value) {
      expect(img.bottom - img.top).toBeCloseTo(400, 0);
      expect(img.top).toBeGreaterThanOrEqual(72 - 1);
      expect(img.bottom).toBeLessThanOrEqual(1056 - 72 + 1);
    }
  }, 120_000);
});
