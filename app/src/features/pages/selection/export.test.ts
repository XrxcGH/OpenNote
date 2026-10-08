// A selection exported to PDF through the installed Edge: one page the size of the crop, with the selected text, image,
// and ink, and nothing else of the page.
import type { Browser } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Rect } from '../pagination/geometry';
import { closeBrowser, openBrowser } from '../testing/edgeSurface';
import { pageOf, textBlock } from '../testing/build';
import { printPage } from '../testing/run';
import { pngDataUri, waveStroke } from '../testing/samples';
import { cropPage } from './crop';
import type { Lasso } from './geometry';
import { selectArea } from './select';

let browser: Browser;
beforeAll(async () => {
  browser = await openBrowser();
}, 120_000);
afterAll(() => closeBrowser(browser), 30_000);

const square = (x: number, y: number, w: number, h: number): Lasso => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('exporting a selection to PDF', () => {
  const page = pageOf(
    [
      textBlock('Mitochondria make energy', { x: 100, y: 100, w: 260, h: 50 }, 'keep'),
      { id: 'leaf', type: 'image', data: { asset: 'a1', alt: 'A cell' }, frame: { x: 380, y: 100, w: 120, h: 80 } },
      textBlock('Unrelated shopping list', { x: 100, y: 900, w: 260, h: 50 }, 'drop'),
      textBlock('Flowing note', undefined, 'flow'),
      { id: 'ink1', type: 'ink', data: { role: 'layer', strokeCount: 2 }, frame: { x: 0, y: 0 } },
    ],
    {
      strokes: [waveStroke('ink1', 120, 250, 300), waveStroke('ink1', 120, 950, 200)],
      assets: { a1: { file: 'cell.png', mime: 'image/png', name: 'cell.png', width: 48, height: 32 } },
    },
  );
  const boxes = new Map<string, Rect>([['flow', { x: 100, y: 300, w: 260, h: 30 }]]);
  const images = { a1: pngDataUri(48, 32, [47, 79, 154]) };

  it('is one page the size of the crop, with only the selected content', async () => {
    const sel = selectArea(page, square(90, 90, 430, 260), { boxes })!;
    const cropped = cropPage(page, sel, { boxes, inkAlt: 'A sketch of a cell' });
    const { result } = await printPage(browser, cropped, {}, images);
    const { info, problems } = result;
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(info.pages).toHaveLength(1);
    // Chromium rounds a page to its own grid, up to a point more than the crop.
    expect(Math.abs(info.pages[0].width - sel.crop.w * 0.75)).toBeLessThanOrEqual(1);
    expect(Math.abs(info.pages[0].height - sel.crop.h * 0.75)).toBeLessThanOrEqual(1);
    expect(info.pages[0].text).toContain('Mitochondria make energy');
    expect(info.pages[0].text).toContain('Flowing note');
    expect(info.pages[0].text).not.toContain('shopping');
    expect(info.pages[0].images).toBe(1);
    expect(info.pages[0].fills).toBeGreaterThan(0);
  }, 120_000);

  it('describes the handwriting in the structure of the file', async () => {
    const sel = selectArea(page, square(90, 90, 430, 260), { boxes })!;
    const { result } = await printPage(
      browser,
      cropPage(page, sel, { boxes, inkAlt: 'A sketch of a cell' }),
      {},
      images,
    );
    expect(result.info.structure.Figure).toBeGreaterThanOrEqual(2);
    expect(result.info.figuresWithAlt).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
